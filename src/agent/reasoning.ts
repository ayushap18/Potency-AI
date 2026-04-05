/**
 * reasoning.ts — Reasoning modules (TypeScript port of AgentX reasoning/)
 *
 * Implements 4 reasoning modules that analyze retrieved sources:
 *   - ArchitectureAnalyzer: architectural patterns, scalability, ops complexity
 *   - TradeoffComparator: multi-dimensional technology comparison
 *   - PerformanceEvaluator: performance and benchmarking analysis
 *   - CodeQualityReviewer: code patterns, best practices
 *
 * Module selection is automatic based on QueryCategory.
 */

import { callLLMJson } from './localLLM';
import type { AnalysisResult, RetrievedSource, QueryCategory } from './pipeline';
import type { PotencyMode } from './modelRouter';

// ---------------------------------------------------------------------------
// Base reasoning interface
// ---------------------------------------------------------------------------

interface ReasoningContext {
  research_question: string;
  entities: string[];
  domain: string;
  constraints: string[];
  technology?: string;
}

interface ReasoningModule {
  module_name: string;
  analyze(
    sources: RetrievedSource[],
    context: ReasoningContext,
    mode: PotencyMode,
  ): Promise<AnalysisResult>;
}

function formatSources(sources: RetrievedSource[]): string {
  return sources
    .map((s, i) =>
      `[Source ${i + 1}] ${s.title}\nURL: ${s.url}\nType: ${s.source_type}\nContent:\n${s.content.slice(0, 2000)}`)
    .join('\n---\n');
}

// ---------------------------------------------------------------------------
// Architecture Analyzer
// ---------------------------------------------------------------------------

const architectureAnalyzer: ReasoningModule = {
  module_name: 'architecture_analysis',

  async analyze(sources, context, mode): Promise<AnalysisResult> {
    const systemPrompt = `You are an expert software architect. Analyze the provided sources and respond with a JSON object containing:
{
  "architecture_analysis": {
    "patterns_identified": ["pattern1", "pattern2"],
    "scalability_assessment": "brief assessment",
    "operational_complexity": "low|medium|high",
    "strengths": ["strength1"],
    "weaknesses": ["weakness1"],
    "recommendation": "brief recommendation"
  }
}
Respond ONLY with valid JSON. Be concise.`;

    const userPrompt = `Research question: ${context.research_question}
Technology: ${context.technology || context.entities.join(', ')}

Sources:
${formatSources(sources)}

Analyze the architectural aspects.`;

    try {
      const result = await callLLMJson(systemPrompt, userPrompt, mode);
      return {
        module_name: this.module_name,
        result: (result?.architecture_analysis || result || Object.create(null)) as Record<string, unknown>,
        confidence: 0.7,
      };
    } catch {
      return { module_name: this.module_name, result: {} as Record<string, unknown>, confidence: 0 };
    }
  },
};

// ---------------------------------------------------------------------------
// Tradeoff Comparator
// ---------------------------------------------------------------------------

const tradeoffComparator: ReasoningModule = {
  module_name: 'tradeoff_comparison',

  async analyze(sources, context, mode): Promise<AnalysisResult> {
    const technologies = context.entities.join(' vs ');

    const systemPrompt = `You are a technology comparison expert. Compare the technologies across multiple dimensions. Respond with a JSON object:
{
  "comparison": {
    "dimensions": [
      { "dimension": "Performance", "scores": { "tech_a": 8, "tech_b": 7 }, "notes": "brief" }
    ],
    "overall_recommendation": "brief recommendation",
    "best_for": { "use_case_1": "tech_a", "use_case_2": "tech_b" }
  }
}
Respond ONLY with valid JSON. Be concise.`;

    const userPrompt = `Compare: ${technologies}
Use case: ${context.research_question}
Constraints: ${context.constraints.join(', ') || 'none'}

Sources:
${formatSources(sources)}`;

    try {
      const result = await callLLMJson(systemPrompt, userPrompt, mode);
      return {
        module_name: this.module_name,
        result: (result?.comparison || result || Object.create(null)) as Record<string, unknown>,
        confidence: 0.7,
      };
    } catch {
      return { module_name: this.module_name, result: {} as Record<string, unknown>, confidence: 0 };
    }
  },
};

// ---------------------------------------------------------------------------
// Performance Evaluator
// ---------------------------------------------------------------------------

const performanceEvaluator: ReasoningModule = {
  module_name: 'performance_evaluation',

  async analyze(sources, context, mode): Promise<AnalysisResult> {
    const systemPrompt = `You are a performance engineering expert. Evaluate performance characteristics from the sources. Respond with a JSON object:
{
  "performance_evaluation": {
    "benchmarks": [{ "metric": "name", "value": "value", "context": "brief" }],
    "bottlenecks": ["bottleneck1"],
    "optimization_opportunities": ["opportunity1"],
    "scalability_limits": "brief assessment"
  }
}
Respond ONLY with valid JSON. Be concise.`;

    const userPrompt = `Evaluate performance for: ${context.research_question}
Technology: ${context.technology || context.entities.join(', ')}

Sources:
${formatSources(sources)}`;

    try {
      const result = await callLLMJson(systemPrompt, userPrompt, mode);
      return {
        module_name: this.module_name,
        result: (result?.performance_evaluation || result || Object.create(null)) as Record<string, unknown>,
        confidence: 0.7,
      };
    } catch {
      return { module_name: this.module_name, result: {} as Record<string, unknown>, confidence: 0 };
    }
  },
};

// ---------------------------------------------------------------------------
// Code Quality Reviewer
// ---------------------------------------------------------------------------

const codeQualityReviewer: ReasoningModule = {
  module_name: 'code_quality_review',

  async analyze(sources, context, mode): Promise<AnalysisResult> {
    const systemPrompt = `You are a senior code reviewer. Analyze code patterns and practices from the sources. Respond with a JSON object:
{
  "code_quality_review": {
    "patterns_used": ["pattern1"],
    "best_practices_followed": ["practice1"],
    "anti_patterns_found": ["anti_pattern1"],
    "testing_assessment": "brief assessment",
    "maintainability_score": 7,
    "suggestions": ["suggestion1"]
  }
}
Respond ONLY with valid JSON. Be concise.`;

    const userPrompt = `Review code quality for: ${context.research_question}
Technology: ${context.technology || context.entities.join(', ')}

Sources:
${formatSources(sources)}`;

    try {
      const result = await callLLMJson(systemPrompt, userPrompt, mode);
      return {
        module_name: this.module_name,
        result: (result?.code_quality_review || result || Object.create(null)) as Record<string, unknown>,
        confidence: 0.7,
      };
    } catch {
      return { module_name: this.module_name, result: {} as Record<string, unknown>, confidence: 0 };
    }
  },
};

// ---------------------------------------------------------------------------
// Module Registry & Selection
// ---------------------------------------------------------------------------

const ALL_MODULES: ReasoningModule[] = [
  architectureAnalyzer,
  tradeoffComparator,
  performanceEvaluator,
  codeQualityReviewer,
];

/**
 * Maps query categories to the reasoning modules that should be activated.
 */
const CATEGORY_MODULES: Record<string, string[]> = {
  COMPARISON: ['tradeoff_comparison', 'performance_evaluation'],
  EXPLANATION: ['architecture_analysis'],
  EVALUATION: ['performance_evaluation', 'architecture_analysis'],
  IMPLEMENTATION: ['code_quality_review', 'architecture_analysis'],
  EXPLORATION: ['architecture_analysis'],
};

/**
 * Get reasoning modules that should be activated for a given query category and mode.
 */
export function getModulesForCategory(
  category: QueryCategory,
  mode: PotencyMode,
): ReasoningModule[] {
  // Fast mode: skip reasoning modules entirely
  if (mode === 'fast') return [];

  const moduleNames = CATEGORY_MODULES[category] || ['architecture_analysis'];

  // Thinking mode: use first 1-2 modules only
  const limit = mode === 'thinking' ? 2 : ALL_MODULES.length;

  return ALL_MODULES
    .filter(m => moduleNames.includes(m.module_name))
    .slice(0, limit);
}

/**
 * Run all applicable reasoning modules in parallel.
 */
export async function runReasoningModules(
  category: QueryCategory,
  sources: RetrievedSource[],
  context: ReasoningContext,
  mode: PotencyMode,
): Promise<AnalysisResult[]> {
  const modules = getModulesForCategory(category, mode);
  if (modules.length === 0) return [];

  const results = await Promise.allSettled(
    modules.map(m => m.analyze(sources, context, mode)),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<AnalysisResult> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter(r => r.confidence > 0);
}
