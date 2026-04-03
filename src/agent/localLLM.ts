/**
 * localLLM.ts — Thin wrapper around the RunAnywhere TextGeneration WASM API.
 * Provides callLLM() for full-text JSON responses and streamLLM() for token streaming.
 * No server, no API key — inference runs 100% in the browser via llama.cpp WASM.
 */

import { TextGeneration } from '@runanywhere/web-llamacpp';

/** Error thrown when LLM JSON parsing fails after all retries */
export class LLMJsonParseError extends Error {
  constructor(public readonly rawOutput: string) {
    super('Failed to parse LLM output as JSON');
    this.name = 'LLMJsonParseError';
  }
}

/** Error thrown when operation is aborted */
export class LLMAbortError extends Error {
  constructor() {
    super('LLM operation was aborted');
    this.name = 'LLMAbortError';
  }
}

/**
 * Generate text synchronously. Returns the full output string.
 * Adds a simple system/user prompt wrapper for instruction-tuned models.
 * @param signal - Optional AbortSignal for cancellation
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600,
  temperature = 0.2,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new LLMAbortError();
  
  // LFM2 instruction format (works for both 350M and 1.2B-Tool)
  const prompt = formatPrompt(systemPrompt, userPrompt);

  const { result } = await TextGeneration.generateStream(prompt, {
    maxTokens,
    temperature,
  });
  
  if (signal?.aborted) throw new LLMAbortError();
  
  const r = await result;
  return r.text.trim();
}

/**
 * Stream tokens as an async generator.
 * Yields string token chunks as they are produced by the WASM engine.
 * @param signal - Optional AbortSignal for cancellation
 */
export async function* streamLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1200,
  temperature = 0.3,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (signal?.aborted) throw new LLMAbortError();
  
  const prompt = formatPrompt(systemPrompt, userPrompt);
  const { stream } = await TextGeneration.generateStream(prompt, {
    maxTokens,
    temperature,
  });
  for await (const token of stream) {
    if (signal?.aborted) throw new LLMAbortError();
    if (token) yield token;
  }
}

/** Options for JSON LLM calls */
export interface CallLLMJsonOptions {
  maxTokens?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

/**
 * Try to extract and parse JSON from raw LLM output.
 * Returns null if parsing fails.
 */
function tryParseJson<T>(raw: string): T | null {
  // Try direct parse
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Try extracting first {...} block
    const start = raw.indexOf('{');
    if (start !== -1) {
      let depth = 0;
      for (let i = start; i < raw.length; i++) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(raw.slice(start, i + 1)) as T;
            } catch {
              break;
            }
          }
        }
      }
    }
    return null;
  }
}

/**
 * Call LLM and try to parse the response as JSON.
 * Falls back to extracting the first JSON object if the model returns extra text.
 * Retries with increasing temperature if parsing fails.
 * 
 * @throws {LLMJsonParseError} If JSON parsing fails after all retries
 * @throws {LLMAbortError} If the operation is aborted
 */
export async function callLLMJson<T = Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  options: CallLLMJsonOptions = {},
): Promise<T> {
  const { maxTokens = 400, maxRetries = 2, signal } = options;
  
  let lastRaw = '';
  const temperatures = [0.1, 0.2, 0.35]; // Increase temperature on retries
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new LLMAbortError();
    
    const temp = temperatures[Math.min(attempt, temperatures.length - 1)];
    const raw = await callLLM(systemPrompt, userPrompt, maxTokens, temp, signal);
    lastRaw = raw;
    
    const parsed = tryParseJson<T>(raw);
    if (parsed !== null) {
      return parsed;
    }
    
    if (attempt < maxRetries) {
      console.warn(`[localLLM] JSON parse failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying with temp=${temperatures[attempt + 1]}`);
    }
  }
  
  // All retries exhausted
  console.error('[localLLM] JSON parse failed after all retries, raw:', lastRaw.slice(0, 300));
  throw new LLMJsonParseError(lastRaw);
}

function formatPrompt(system: string, user: string): string {
  // LFM2 model optimized prompt format
  return `<|system|>${system}<|end|>\n<|user|>${user}<|end|>\n<|assistant|>`;
}
