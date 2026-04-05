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
  RESEARCH_PLANNING,
  SYNTHESIS,
  FOLLOW_UP,
  SEARCH_QUERY_GEN,
} from './prompts';
import { retrieveSources, formatSourcesForPrompt, type RetrievedSource } from './retrieval';
import type { PotencyMode } from './modelRouter';
import { runReasoningModules } from './reasoning';
import type { QueryCategory, AnalysisResult } from './pipeline';

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
  mode?: PotencyMode;
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
    // ── Stage 1: Intent Classification ──
    checkAborted();
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
        { mode: options.mode || 'fast', signal }
      );
      if (raw.category) intent = { ...intent, ...raw };
      emit('intent', 'done', `${intent.category} · ${intent.mode}`);
    } catch (err) {
      if (!isRecoverableError(err)) throw err;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[Agent] Intent classification failed, using defaults:', errMsg);
      emit('intent', 'partial', 'Using default intent', `Intent classification failed: ${errMsg}`);
    }

    // ── Stage 2: Research Planning ──
    checkAborted();
    emit('planning', 'running');

    let searchQueries: string[] = [query];

    try {
      // Generate Wikipedia search queries
      const sqRaw = await callLLMJson<{ queries: string[] }>(
        SEARCH_QUERY_GEN.system,
        SEARCH_QUERY_GEN.user({ query }),
        { mode: options.mode || 'fast', signal }
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
        { mode: options.mode || 'fast', signal }
      );
      // planSections extracted but currently unused
      emit('planning', 'done', `${searchQueries.length} search queries`);
    } catch (err) {
      if (!isRecoverableError(err)) throw err;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[Agent] Research planning failed:', errMsg);
      emit('planning', 'partial', 'Using basic search', `Planning failed: ${errMsg}`);
    }

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

    let analysisResults: AnalysisResult[] = [];
    const contextText = formatSourcesForPrompt(sources);

    try {
      analysisResults = await runReasoningModules(
        intent.category as QueryCategory,
        sources,
        {
          research_question: query,
          entities: intent.entities,
          domain: intent.domain,
          constraints: [],
          technology: intent.entities.length > 0 ? intent.entities.join(', ') : query,
        },
        options.mode || 'fast'
      );
      
      if (analysisResults.length > 0) {
        emit('analysis', 'done', `${analysisResults.length} modules completed`);
      } else {
        emit('analysis', 'done', 'Skipped reasoning module');
      }
    } catch (err) {
      if (!isRecoverableError(err)) throw err;
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      console.warn('[Agent] Reasoning modules failed:', errMsg);
      emit('analysis', 'partial', 'Analysis skipped', `Reasoning error: ${errMsg}`);
    }

    // ── Stage 5: Synthesis (streaming) ──
    checkAborted();
    emit('synthesis', 'running');

    let combinedAnalysisText = '';
    if (analysisResults.length > 0) {
      combinedAnalysisText = analysisResults.map(r => `[${r.module_name}]\n${JSON.stringify(r.result, null, 2)}`).join('\n\n');
    }

    const synthesisContext = [
      combinedAnalysisText ? `## Deep Analysis\n${combinedAnalysisText}` : '',
      sources.length > 0 ? `## Sources\n${truncateAtSentence(contextText, 4000)}` : '',
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
      0, // falsy maxTokens lets streamLLM fallback to mode config
      undefined, // undefined temperature lets streamLLM fallback to mode config
      signal,
      options.mode || 'fast'
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
          report_summary: reportAccumulated.slice(0, 1000),
        }),
        { mode: options.mode || 'fast', signal }
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
