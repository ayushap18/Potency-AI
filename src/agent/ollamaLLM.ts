/**
 * ollamaLLM.ts — LLM wrapper using Ollama (Gemma 4) for the research agent.
 * Drop-in replacement for localLLM.ts functions but routes through Ollama REST API.
 */

import { ollamaChat, streamOllamaChat, type OllamaChatMessage } from '../services/ollama';

const OLLAMA_MODEL = 'gemma4:latest';

export class LLMAbortError extends Error {
  constructor() {
    super('LLM operation was aborted');
    this.name = 'LLMAbortError';
  }
}

export class LLMJsonParseError extends Error {
  constructor(public readonly rawOutput: string) {
    super('Failed to parse LLM output as JSON');
    this.name = 'LLMJsonParseError';
  }
}

/** Generate text via Ollama. Returns the full output string. */
export async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600,
  temperature = 0.2,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) throw new LLMAbortError();

  const messages: OllamaChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  return ollamaChat({ model: OLLAMA_MODEL, messages, temperature, maxTokens, signal });
}

/** Stream tokens from Ollama as an async generator. */
export async function* streamLLM(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1200,
  temperature = 0.3,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (signal?.aborted) throw new LLMAbortError();

  const messages: OllamaChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  const stream = streamOllamaChat({ model: OLLAMA_MODEL, messages, temperature, maxTokens, signal });

  for await (const token of stream) {
    if (signal?.aborted) throw new LLMAbortError();
    if (token) yield token;
  }
}

/** Try to extract and parse JSON from raw LLM output. */
function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Try extracting first {...} or [...] block
    const start = raw.indexOf('{');
    const arrStart = raw.indexOf('[');
    const useArr = arrStart !== -1 && (start === -1 || arrStart < start);
    const openChar = useArr ? '[' : '{';
    const closeChar = useArr ? ']' : '}';
    const begin = useArr ? arrStart : start;

    if (begin !== -1) {
      let depth = 0;
      for (let i = begin; i < raw.length; i++) {
        if (raw[i] === openChar) depth++;
        else if (raw[i] === closeChar) {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(raw.slice(begin, i + 1)) as T;
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

export interface CallLLMJsonOptions {
  maxTokens?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}

/** Call Ollama and parse response as JSON, with retries. */
export async function callLLMJson<T = Record<string, unknown>>(
  systemPrompt: string,
  userPrompt: string,
  options: CallLLMJsonOptions = {},
): Promise<T> {
  const { maxTokens = 400, maxRetries = 2, signal } = options;

  let lastRaw = '';
  const temperatures = [0.1, 0.2, 0.35];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new LLMAbortError();

    const temp = temperatures[Math.min(attempt, temperatures.length - 1)];
    const raw = await callLLM(systemPrompt, userPrompt, maxTokens, temp, signal);
    lastRaw = raw;

    const parsed = tryParseJson<T>(raw);
    if (parsed !== null) return parsed;

    if (attempt < maxRetries) {
      console.warn(`[ollamaLLM] JSON parse failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying`);
    }
  }

  console.error('[ollamaLLM] JSON parse failed after all retries, raw:', lastRaw.slice(0, 300));
  throw new LLMJsonParseError(lastRaw);
}
