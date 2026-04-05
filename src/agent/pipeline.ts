/**
 * pipeline.ts — Research pipeline types (TypeScript port of AgentX pipeline.py)
 *
 * Defines the data structures used throughout the research pipeline:
 * intent classification, research planning, retrieval, analysis, and reporting.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum QueryCategory {
  COMPARISON = 'COMPARISON',
  EXPLANATION = 'EXPLANATION',
  EVALUATION = 'EVALUATION',
  IMPLEMENTATION = 'IMPLEMENTATION',
  EXPLORATION = 'EXPLORATION',
}

export enum ResearchMode {
  QUICK = 'quick',
  DEEP = 'deep',
}

// ---------------------------------------------------------------------------
// Pipeline Stage Types
// ---------------------------------------------------------------------------

export interface IntentResult {
  category: QueryCategory;
  mode: ResearchMode;
  entities: string[];
  domain: string;
  constraints: string[];
  refined_query: string;
}

export interface ResearchTask {
  id: string;
  description: string;
  source_types: string[];
  search_queries: string[];
  evidence_needed: string;
  depends_on: string[];
}

export interface ResearchPlan {
  objective: string;
  approach: string;
  tasks: ResearchTask[];
  expected_output_sections: string[];
}

export interface RetrievedSource {
  id: string;
  title: string;
  url: string;
  content: string;
  source_type: string; // 'documentation' | 'papers' | 'blogs' | 'code' | 'wikipedia'
  relevance_score: number;
  credibility_score: number;
  metadata: Record<string, unknown>;
}

export interface AnalysisResult {
  module_name: string;
  result: Record<string, unknown>;
  confidence: number;
}

export interface ResearchReport {
  query: string;
  mode: ResearchMode;
  intent: IntentResult;
  report_markdown: string;
  sources: RetrievedSource[];
  analyses: AnalysisResult[];
  follow_ups: string[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    llmCalls: number;
    totalTimeMs: number;
    cost: number; // always 0 for local
    sourceCount: number;
  };
  /** Mermaid diagram code generated for the report, if applicable */
  diagram?: string;
}

// ---------------------------------------------------------------------------
// Pipeline Events (for real-time UI updates)
// ---------------------------------------------------------------------------

export enum PipelineStage {
  INTENT = 'intent',
  PLANNING = 'planning',
  RETRIEVAL = 'retrieval',
  ANALYSIS = 'analysis',
  SYNTHESIS = 'synthesis',
  FOLLOW_UP = 'follow_up',
  DIAGRAM = 'diagram',
  COMPLETE = 'complete',
  ERROR = 'error',
}

export type AgentId = 'classifier' | 'planner' | 'retriever' | 'analyst' | 'writer';

/** Maps pipeline stages to agent IDs for status tracking */
export const STAGE_TO_AGENT: Record<PipelineStage, AgentId | null> = {
  [PipelineStage.INTENT]: 'classifier',
  [PipelineStage.PLANNING]: 'planner',
  [PipelineStage.RETRIEVAL]: 'retriever',
  [PipelineStage.ANALYSIS]: 'analyst',
  [PipelineStage.SYNTHESIS]: 'writer',
  [PipelineStage.FOLLOW_UP]: 'writer',
  [PipelineStage.DIAGRAM]: 'writer',
  [PipelineStage.COMPLETE]: null,
  [PipelineStage.ERROR]: null,
};

export interface PipelineEvent {
  stage: PipelineStage;
  status: 'started' | 'completed' | 'error';
  message: string;
  progress_pct: number;
  data?: Record<string, unknown>;
}

export type PipelineEventHandler = (event: PipelineEvent) => void;
export type BrainThoughtHandler = (thought: string, agent: AgentId) => void;

export interface EventEmitter {
  emit: (event: PipelineEvent) => void;
  think: (thought: string, agent: AgentId) => void;
}

/**
 * Create an event emitter that dispatches to handlers.
 */
export function createEventEmitter(
  onEvent?: PipelineEventHandler,
  onThought?: BrainThoughtHandler,
): EventEmitter {
  return {
    emit: (event: PipelineEvent) => onEvent?.(event),
    think: (thought: string, agent: AgentId) => onThought?.(thought, agent),
  };
}
