/**
 * prompts.ts — All AgentX prompt templates ported to TypeScript.
 * These are the exact prompts from AgentX/app/llm/prompts.py, adapted for
 * smaller local models (more explicit JSON examples, shorter system prompts).
 */

export interface Prompt {
  system: string;
  user: (vars: Record<string, string>) => string;
}

// ── 1. Intent Classification ──────────────────────────────────────────────
export const INTENT_CLASSIFICATION: Prompt = {
  system: `You are a technical research query classifier.
Classify into ONE category: COMPARISON, EXPLANATION, EVALUATION, IMPLEMENTATION, EXPLORATION.
Mode: QUICK (focused) or DEEP (multi-source synthesis).
Extract key technical entities, domain, constraints.
Respond ONLY with valid JSON, no other text:
{"category":"EXPLANATION","mode":"QUICK","entities":["entity1"],"domain":"databases","constraints":[],"refined_query":"clearer version"}`,
  user: ({ query }) => query,
};

// ── 2. Research Planning ──────────────────────────────────────────────────
export const RESEARCH_PLANNING: Prompt = {
  system: `You are a senior research engineer. Given a classified query, create a structured research plan.
Break into 3-5 specific sub-tasks. Order by dependency. Be concrete.
Respond ONLY with valid JSON:
{"objective":"one sentence","tasks":[{"id":"t1","description":"specific task","search_queries":["query1"],"evidence_needed":"what to find"}],"output_sections":["section1","section2"]}`,
  user: ({ intent, query }) =>
    `Intent classification: ${intent}\n\nOriginal query: ${query}`,
};

// ── 3. Architecture Analysis ──────────────────────────────────────────────
export const ARCHITECTURE_ANALYSIS: Prompt = {
  system: `You are a senior software architect. Analyze the provided technical context.
Extract: core patterns, scalability characteristics, key tradeoffs, integrations.
Ground every claim in the provided material. Do NOT fabricate.
Respond ONLY with valid JSON:
{"patterns":["pattern: description"],"scalability":"assessment","tradeoffs":[{"tradeoff":"desc","implication":"impact"}],"key_insight":"one sentence summary"}`,
  user: ({ technology, query, context }) =>
    `Technology: ${technology}\nQuestion: ${query}\n\nContext:\n${context}`,
};

// ── 4. Tradeoff Comparison ────────────────────────────────────────────────
export const TRADEOFF_COMPARISON: Prompt = {
  system: `You are a senior engineer conducting a rigorous technical comparison.
Compare across: performance, scalability, developer experience, ecosystem, cost.
Say "Insufficient evidence" rather than guessing. Use numbers when available.
Respond ONLY with valid JSON:
{"dimensions":[{"name":"performance","winner":"tech_a","summary":"why"}],"recommendation":"tech_a or tech_b","confidence":"HIGH|MEDIUM|LOW","reasoning":"why","when_to_choose_alternative":"scenario"}`,
  user: ({ technologies, use_case, context }) =>
    `Technologies: ${technologies}\nUse case: ${use_case}\n\nContext:\n${context}`,
};

// ── 5. Report Synthesis ───────────────────────────────────────────────────
export const SYNTHESIS: Prompt = {
  system: `You are a senior technical writer producing an engineering research report.
Write in Markdown. Required sections:
1. **Executive Summary** (3-5 sentences with key findings)
2. **Core Concepts** (background, how it works)
3. **Analysis** (detailed findings, patterns, tradeoffs)
4. **Practical Recommendations** (concrete, justified guidance with code examples if relevant)
5. **Mermaid Architecture Diagram** (use \`\`\`mermaid graph TD\`\`\` block)
6. **Key Takeaways** (3-5 bullet points)

Style: direct, concise, engineering-grade. Use tables for comparisons. State confidence levels.
Do NOT add filler text or repeat the query.`,
  user: ({ query, analysis, mode }) =>
    `Query: ${query}\nMode: ${mode}\n\nAnalysis & Context:\n${analysis}\n\nGenerate a complete Markdown research report.`,
};

// ── 6. Follow-up Questions ────────────────────────────────────────────────
export const FOLLOW_UP: Prompt = {
  system: `You are a research assistant. Generate 4 insightful follow-up questions.
Questions must: be specific, actionable, cover different angles (implementation, alternatives, performance, security).
Respond ONLY with valid JSON:
{"questions":["question 1","question 2","question 3","question 4"]}`,
  user: ({ query, report_summary }) =>
    `Original query: ${query}\n\nReport summary:\n${report_summary.slice(0, 800)}`,
};

// ── 7. Wikipedia Search Query Generator ──────────────────────────────────
export const SEARCH_QUERY_GEN: Prompt = {
  system: `You are a search expert. Given a research question, generate 3 concise Wikipedia search terms.
Respond ONLY with valid JSON:
{"queries":["term1","term2","term3"]}`,
  user: ({ query }) => `Research question: ${query}`,
};
