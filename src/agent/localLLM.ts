/**
 * localLLM.ts — Thin wrapper around the RunAnywhere TextGeneration WASM API.
 * Provides callLLM() for full-text JSON responses and streamLLM() for token streaming.
 * No server, no API key — inference runs 100% in the browser via llama.cpp WASM.
 */

import { TextGeneration } from '@runanywhere/web-llamacpp';

/**
 * Generate text synchronously. Returns the full output string.
 * Adds a simple system/user prompt wrapper for instruction-tuned models.
 */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600,
  temperature = 0.2,
): Promise<string> {
  // LFM2 instruction format (works for both 350M and 1.2B-Tool)
  const prompt = formatPrompt(systemPrompt, userPrompt);

  const { result } = await TextGeneration.generateStream(prompt, {
    maxTokens,
    temperature,
  });
  const r = await result;
  return r.text.trim();
}

/**
 * Stream tokens as an async generator.
 * Yields string token chunks as they are produced by the WASM engine.
 */
export async function* streamLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1200,
  temperature = 0.3,
): AsyncGenerator<string> {
  const prompt = formatPrompt(systemPrompt, userPrompt);
  const { stream } = await TextGeneration.generateStream(prompt, {
    maxTokens,
    temperature,
  });
  for await (const token of stream) {
    if (token) yield token;
  }
}

/**
 * Call LLM and try to parse the response as JSON.
 * Falls back to extracting the first JSON object if the model returns extra text.
 */
export async function callLLMJson<T = Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 400,
): Promise<T> {
  const raw = await callLLM(systemPrompt, userPrompt, maxTokens, 0.1);

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
    // Cannot parse — return empty object so pipeline can continue gracefully
    console.warn('[localLLM] JSON parse failed, raw:', raw.slice(0, 200));
    return {} as T;
  }
}

function formatPrompt(system: string, user: string): string {
  // Generic instruction-tuned format compatible with LFM2 models
  return `System: ${system}\n\nUser: ${user}\n\nAssistant:`;
}
