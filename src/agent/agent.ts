/**
 * agent.ts — Local Research Agent Orchestrator
 *
 * This is the TypeScript port of AgentX's ResearchOrchestrator.
 * The full pipeline runs 100% locally: no Python, no API keys.
 *
 * Pipeline:
 *   1. Intent Classification  ← local LLM
 *   2. Research Planning      ← local LLM
 *   3. Source Retrieval       ← Wikipedia REST API (CORS-free)
 *   4. Architecture Analysis  ← local LLM
 *   5. Tradeoff Comparison    ← local LLM (if COMPARISON query)
 *   6. Synthesis              ← local LLM (streaming Markdown report)
 *   7. Follow-up Questions    ← local LLM
 */

import { callLLM, callLLMJson, streamLLM } from './localLLM';
import {
  INTENT_CLASSIFICATION,
  RESEARCH_PLANNING,
  ARCHITECTURE_ANALYSIS,
  TRADEOFF_COMPARISON,
  SYNTHESIS,
  FOLLOW_UP,
  SEARCH_QUERY_GEN,
} from './prompts';
import { retrieveSources, formatSourcesForPrompt, type RetrievedSource } from './retrieval';

// ── Public Types ──────────────────────────────────────────────────────────

export type PipelineStageId =
  | 'intent'
  | 'planning'
  | 'retrieval'
  | 'analysis'
  | 'synthesis'
  | 'followup';

export type PipelineStatus = 'idle' | 'running' | 'done' | 'error';

export interface PipelineUpdate {
  stage: PipelineStageId;
  status: PipelineStatus;
  detail?: string;
}

export interface IntentResult {
  category: string;
  mode: string;
  entities: string[];
  domain: string;
  refined_query?: string;
}

export interface AgentCallbacks {
  onStageUpdate: (update: PipelineUpdate) => void;
  onToken: (token: string) => void;
  onComplete: (result: FinalResult) => void;
  onError: (message: string) => void;
}

export interface FinalResult {
  report: string;
  sources: RetrievedSource[];
  intent: IntentResult;
  followUps: string[];
  elapsedMs: number;
}

// ── Orchestrator ──────────────────────────────────────────────────────────

export async function runResearchAgent(
  query: string,
  callbacks: AgentCallbacks,
): Promise<void> {
  const start = Date.now();
  const { onStageUpdate, onToken, onComplete, onError } = callbacks;

  const emit = (stage: PipelineStageId, status: PipelineStatus, detail?: string) => {
    onStageUpdate({ stage, status, detail });
  };

  try {
    // ── Stage 1: Intent Classification ──
    emit('intent', 'running');

    let intent: IntentResult = {
      category: 'EXPLANATION',
      mode: 'QUICK',
      entities: [],
      domain: 'general',
    };

    try {
      const raw = await callLLMJson<IntentResult>(
        INTENT_CLASSIFICATION.system,
        INTENT_CLASSIFICATION.user({ query }),
        300,
      );
      if (raw.category) intent = { ...intent, ...raw };
    } catch {
      // non-fatal: proceed with defaults
    }

    emit('intent', 'done', `${intent.category} · ${intent.mode}`);

    // ── Stage 2: Research Planning ──
    emit('planning', 'running');

    let searchQueries: string[] = [query];
    let planSections: string[] = [];

    try {
      // Generate Wikipedia search queries
      const sqRaw = await callLLMJson<{ queries: string[] }>(
        SEARCH_QUERY_GEN.system,
        SEARCH_QUERY_GEN.user({ query }),
        200,
      );
      if (sqRaw.queries?.length) {
        searchQueries = [query, ...sqRaw.queries].slice(0, 4);
      }

      // Full research plan
      const planRaw = await callLLMJson<{ objective?: string; tasks?: unknown[]; output_sections?: string[] }>(
        RESEARCH_PLANNING.system,
        RESEARCH_PLANNING.user({
          intent: JSON.stringify(intent),
          query,
        }),
        400,
      );
      planSections = planRaw.output_sections ?? [];
    } catch {
      // non-fatal
    }

    emit('planning', 'done', `${searchQueries.length} search queries`);

    // ── Stage 3: Source Retrieval ──
    emit('retrieval', 'running', 'Searching Wikipedia…');

    let sources: RetrievedSource[] = [];
    try {
      sources = await retrieveSources(searchQueries, 2);
    } catch {
      // non-fatal: agent will work with LLM knowledge only
    }

    emit(
      'retrieval',
      'done',
      sources.length > 0 ? `${sources.length} sources found` : 'Using model knowledge',
    );

    // ── Stage 4: Analysis ──
    emit('analysis', 'running');

    const contextText = formatSourcesForPrompt(sources);
    const technology = intent.entities.length > 0 ? intent.entities.join(', ') : query;

    let analysisText = '';

    if (intent.category === 'COMPARISON' && intent.entities.length >= 2) {
      // Tradeoff comparison
      try {
        const compRaw = await callLLMJson<Record<string, unknown>>(
          TRADEOFF_COMPARISON.system,
          TRADEOFF_COMPARISON.user({
            technologies: intent.entities.join(' vs '),
            use_case: intent.domain,
            context: contextText.slice(0, 3000),
          }),
          500,
        );
        analysisText = JSON.stringify(compRaw, null, 2);
      } catch {
        analysisText = contextText.slice(0, 2000);
      }
    } else {
      // Architecture / general analysis
      try {
        const archRaw = await callLLMJson<Record<string, unknown>>(
          ARCHITECTURE_ANALYSIS.system,
          ARCHITECTURE_ANALYSIS.user({
            technology,
            query,
            context: contextText.slice(0, 3000),
          }),
          500,
        );
        analysisText = JSON.stringify(archRaw, null, 2);
      } catch {
        analysisText = contextText.slice(0, 2000);
      }
    }

    emit('analysis', 'done');

    // ── Stage 5: Synthesis (streaming) ──
    emit('synthesis', 'running');

    const synthesisContext = [
      analysisText ? `## Analysis\n${analysisText}` : '',
      sources.length > 0 ? `## Sources\n${contextText.slice(0, 4000)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    let reportAccumulated = '';

    const stream = streamLLM(
      SYNTHESIS.system,
      SYNTHESIS.user({
        query,
        analysis: synthesisContext,
        mode: intent.mode,
      }),
      1400,
      0.35,
    );

    for await (const token of stream) {
      reportAccumulated += token;
      onToken(token);
    }

    emit('synthesis', 'done');

    // ── Stage 6: Follow-up Questions ──
    emit('followup', 'running');

    let followUps: string[] = [];
    try {
      const fuRaw = await callLLMJson<{ questions: string[] }>(
        FOLLOW_UP.system,
        FOLLOW_UP.user({
          query,
          report_summary: reportAccumulated,
        }),
        250,
      );
      followUps = fuRaw.questions ?? [];
    } catch {
      // non-fatal
    }

    emit('followup', 'done');

    // ── Done ──
    onComplete({
      report: reportAccumulated,
      sources,
      intent,
      followUps,
      elapsedMs: Date.now() - start,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    onError(msg);
  }
}
