/**
 * ollama.ts — Ollama REST API client for local LLM inference.
 * Connects to Ollama running on localhost:11434.
 * Supports chat completion (streaming) and embeddings via Gemma 4.
 */

const OLLAMA_BASE = 'http://localhost:11434';

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatOptions {
  model?: string;
  messages: OllamaChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Check if Ollama is running and reachable. */
export async function checkOllamaStatus(): Promise<{ running: boolean; models: string[] }> {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!resp.ok) return { running: false, models: [] };
    const data = await resp.json() as { models: { name: string }[] };
    return { running: true, models: data.models?.map(m => m.name) ?? [] };
  } catch {
    return { running: false, models: [] };
  }
}

/** Stream chat completion from Ollama. Yields token chunks. */
export async function* streamOllamaChat(opts: OllamaChatOptions): AsyncGenerator<string> {
  const { model = 'gemma4:latest', messages, temperature = 0.7, maxTokens = 1024, signal } = opts;

  const resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      options: { temperature, num_predict: maxTokens },
    }),
    signal,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => 'Unknown error');
    throw new Error(`Ollama chat failed (${resp.status}): ${errText}`);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error('No response body from Ollama');

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { message?: { content: string }; done: boolean };
        if (parsed.message?.content) {
          yield parsed.message.content;
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  // Process remaining buffer
  if (buffer.trim()) {
    try {
      const parsed = JSON.parse(buffer) as { message?: { content: string } };
      if (parsed.message?.content) yield parsed.message.content;
    } catch { /* ignore */ }
  }
}

/** Get full (non-streaming) chat response from Ollama. */
export async function ollamaChat(opts: OllamaChatOptions): Promise<string> {
  const { model = 'gemma4:latest', messages, temperature = 0.3, maxTokens = 1024, signal } = opts;

  const resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      options: { temperature, num_predict: maxTokens },
    }),
    signal,
  });

  if (!resp.ok) throw new Error(`Ollama chat failed (${resp.status})`);
  const data = await resp.json() as { message: { content: string } };
  return data.message.content;
}

/** Generate embeddings using Ollama. */
export async function ollamaEmbed(texts: string[], model = 'gemma4:latest'): Promise<number[][]> {
  const resp = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: texts }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Ollama embed failed (${resp.status}): ${errText}`);
  }

  const data = await resp.json() as { embeddings: number[][] };
  return data.embeddings;
}
