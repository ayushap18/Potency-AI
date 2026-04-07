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

import { callLLMJson, streamLLM, LLMJsonParseError, LLMAbortError } from './localLLM';
import {
  INTENT_CLASSIFICATION,
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

export type PipelineStatus = 'idle' | 'running' | 'done' | 'error' | 'partial';

export interface PipelineUpdate {
  stage: PipelineStageId;
  status: PipelineStatus;
  detail?: string;
  warning?: string;
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

export interface AgentOptions {
  signal?: AbortSignal;
}

export interface FinalResult {
  report: string;
  sources: RetrievedSource[];
  intent: IntentResult;
  followUps: string[];
  elapsedMs: number;
  warnings: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Check if error is recoverable (non-fatal) */
function isRecoverableError(err: unknown): boolean {
  if (err instanceof LLMAbortError) return false; // Abort is never recoverable
  if (err instanceof LLMJsonParseError) return true; // JSON parse is recoverable
  if (err instanceof TypeError) return false; // Type errors are bugs
  return true; // Network errors, timeouts, etc. are recoverable
}

/** Truncate text at sentence boundary */
function truncateAtSentence(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  
  // Find last sentence boundary before maxLength
  const truncated = text.slice(0, maxLength);
  const lastPeriod = truncated.lastIndexOf('. ');
  const lastQuestion = truncated.lastIndexOf('? ');
  const lastExclaim = truncated.lastIndexOf('! ');
  const lastNewline = truncated.lastIndexOf('\n');
  
  const boundary = Math.max(lastPeriod, lastQuestion, lastExclaim, lastNewline);
  
  if (boundary > maxLength * 0.5) {
    return text.slice(0, boundary + 1).trim();
  }
  
  // No good boundary found, truncate at word boundary
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > maxLength * 0.8) {
    return text.slice(0, lastSpace).trim() + '…';
  }
  
  return truncated.trim() + '…';
}

// ── Orchestrator ──────────────────────────────────────────────────────────

export async function runResearchAgent(
  query: string,
  callbacks: AgentCallbacks,
  options: AgentOptions = {},
): Promise<void> {
  const { signal } = options;
  const start = Date.now();
  const { onStageUpdate, onToken, onComplete, onError } = callbacks;
  const warnings: string[] = [];

  const emit = (stage: PipelineStageId, status: PipelineStatus, detail?: string, warning?: string) => {
    onStageUpdate({ stage, status, detail, warning });
    if (warning) warnings.push(warning);
  };

  const checkAborted = () => {
    if (signal?.aborted) throw new LLMAbortError();
  };

  try {
    // ── Stage 1 + 2: Intent Classification & Search Query Gen (parallel) ──
    // These two LLM calls don't depend on each other, so run them concurrently.
    // This saves one full LLM round-trip (~2-5s on WASM).
    checkAborted();
    emit('intent', 'running');
    emit('planning', 'running');

    let intent: IntentResult = {
      category: 'EXPLANATION',
      mode: 'QUICK',
      entities: [],
      domain: 'general',
    };
    let searchQueries: string[] = [query];

    const intentPromise = callLLMJson<IntentResult>(
      INTENT_CLASSIFICATION.system,
      INTENT_CLASSIFICATION.user({ query }),
      { maxTokens: 150, maxRetries: 0, signal },
    ).catch((err) => {
      if (!isRecoverableError(err)) throw err;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[Agent] Intent classification failed, using defaults:', errMsg);
      emit('intent', 'partial', 'Using default intent', `Intent classification failed: ${errMsg}`);
      return null;
    });

    // Search query generation runs concurrently with intent classification
    const searchQueryPromise = callLLMJson<{ queries: string[] }>(
      SEARCH_QUERY_GEN.system,
      SEARCH_QUERY_GEN.user({ query }),
      { maxTokens: 100, maxRetries: 0, signal },
    ).catch((err) => {
      if (!isRecoverableError(err)) throw err;
      console.warn('[Agent] Search query gen failed:', err instanceof Error ? err.message : 'Unknown');
      return null;
    });

    const [intentRaw, sqRaw] = await Promise.all([intentPromise, searchQueryPromise]);

    if (intentRaw?.category) intent = { ...intent, ...intentRaw };
    emit('intent', 'done', `${intent.category} · ${intent.mode}`);

    if (sqRaw?.queries?.length) {
      searchQueries = [query, ...sqRaw.queries].slice(0, 4);
    }
    emit('planning', 'done', `${searchQueries.length} search queries`);

    // ── Stage 3: Source Retrieval ──
    checkAborted();
    emit('retrieval', 'running', 'Searching Wikipedia…');

    let sources: RetrievedSource[] = [];
    try {
      sources = await retrieveSources(searchQueries, 2, signal);
    } catch (err) {
      if (!isRecoverableError(err)) throw err;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[Agent] Source retrieval failed:', errMsg);
      emit('retrieval', 'partial', 'Using model knowledge only', `Wikipedia unavailable: ${errMsg}`);
    }

    if (sources.length > 0) {
      emit('retrieval', 'done', `${sources.length} sources found`);
    } else if (warnings.some(w => w.includes('Wikipedia'))) {
      // Already reported partial
    } else {
      emit('retrieval', 'done', 'Using model knowledge');
    }

    // ── Stage 4: Analysis ──
    checkAborted();
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
            context: truncateAtSentence(contextText, 1500),
          }),
          { maxTokens: 300, maxRetries: 0, signal },
        );
        analysisText = JSON.stringify(compRaw, null, 2);
        emit('analysis', 'done');
      } catch (err) {
        if (!isRecoverableError(err)) throw err;
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        console.warn('[Agent] Tradeoff comparison failed:', errMsg);
        analysisText = truncateAtSentence(contextText, 2000);
        emit('analysis', 'partial', 'Using raw context', `Analysis failed: ${errMsg}`);
      }
    } else {
      // Architecture / general analysis
      try {
        const archRaw = await callLLMJson<Record<string, unknown>>(
          ARCHITECTURE_ANALYSIS.system,
          ARCHITECTURE_ANALYSIS.user({
            technology,
            query,
            context: truncateAtSentence(contextText, 1500),
          }),
          { maxTokens: 300, maxRetries: 0, signal },
        );
        analysisText = JSON.stringify(archRaw, null, 2);
        emit('analysis', 'done');
      } catch (err) {
        if (!isRecoverableError(err)) throw err;
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        console.warn('[Agent] Architecture analysis failed:', errMsg);
        analysisText = truncateAtSentence(contextText, 2000);
        emit('analysis', 'partial', 'Using raw context', `Analysis failed: ${errMsg}`);
      }
    }

    // ── Stage 5: Synthesis (streaming) ──
    checkAborted();
    emit('synthesis', 'running');

    const synthesisContext = [
      analysisText ? `## Analysis\n${analysisText}` : '',
      sources.length > 0 ? `## Sources\n${truncateAtSentence(contextText, 2000)}` : '',
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
      600,
      0.35,
      signal,
    );

    for await (const token of stream) {
      checkAborted();
      reportAccumulated += token;
      onToken(token);
    }

    emit('synthesis', 'done');

    // ── Stage 6: Follow-up Questions ──
    checkAborted();
    emit('followup', 'running');

    let followUps: string[] = [];
    try {
      const fuRaw = await callLLMJson<{ questions: string[] }>(
        FOLLOW_UP.system,
        FOLLOW_UP.user({
          query,
          report_summary: reportAccumulated.slice(0, 400),
        }),
        { maxTokens: 150, maxRetries: 0, signal },
      );
      followUps = fuRaw.questions ?? [];
      emit('followup', 'done');
    } catch (err) {
      if (!isRecoverableError(err)) throw err;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[Agent] Follow-up generation failed:', errMsg);
      emit('followup', 'partial', 'No follow-ups generated', `Follow-up failed: ${errMsg}`);
    }

    // ── Done ──
    onComplete({
      report: reportAccumulated,
      sources,
      intent,
      followUps,
      elapsedMs: Date.now() - start,
      warnings,
    });
  } catch (err) {
    if (err instanceof LLMAbortError) {
      onError('Research cancelled');
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Agent] Fatal error:', err);
    onError(msg);
  }
}
