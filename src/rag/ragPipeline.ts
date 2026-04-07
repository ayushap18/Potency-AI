/**
 * ragPipeline.ts — RAG orchestration: ingest documents, embed, query with context.
 * Uses nomic-embed-text for embeddings and Gemma 4 for generation via Ollama.
 */

import { chunkText, extractTextFromFile, type DocChunk } from './chunker';
import { VectorStore } from './vectorStore';
import { ollamaEmbed, streamOllamaChat, type OllamaChatMessage } from '../services/ollama';

const EMBED_BATCH_SIZE = 8;
const EMBED_MODEL = 'nomic-embed-text';

export interface IngestProgress {
  stage: 'extracting' | 'chunking' | 'embedding';
  current: number;
  total: number;
}

export class RAGPipeline {
  private store = new VectorStore();
  private chatModel: string;

  constructor(chatModel = 'gemma4:latest') {
    this.chatModel = chatModel;
  }

  get storeSize() { return this.store.size; }
  get sources() { return this.store.getSources(); }

  /** Ingest a file: extract text -> chunk -> embed -> store. */
  async ingestFile(
    file: File,
    onProgress?: (p: IngestProgress) => void,
  ): Promise<{ chunks: number; source: string }> {
    const source = file.name;

    // Remove existing chunks from this source (re-ingest)
    this.store.removeSource(source);

    // 1. Extract text
    onProgress?.({ stage: 'extracting', current: 0, total: 1 });
    const text = await extractTextFromFile(file);
    if (!text.trim()) throw new Error(`No text content found in ${file.name}`);

    // 2. Chunk
    onProgress?.({ stage: 'chunking', current: 0, total: 1 });
    const chunks = chunkText(text, source);
    if (chunks.length === 0) throw new Error('No chunks generated');

    // 3. Embed in batches
    const allEmbeddings: number[][] = [];
    for (let i = 0; i < chunks.length; i += EMBED_BATCH_SIZE) {
      const batch = chunks.slice(i, i + EMBED_BATCH_SIZE);
      onProgress?.({ stage: 'embedding', current: i, total: chunks.length });
      const embeddings = await ollamaEmbed(batch.map(c => c.text), EMBED_MODEL);
      allEmbeddings.push(...embeddings);
    }
    onProgress?.({ stage: 'embedding', current: chunks.length, total: chunks.length });

    // 4. Store
    this.store.addChunks(chunks, allEmbeddings);

    return { chunks: chunks.length, source };
  }

  /** Query: embed question -> retrieve relevant chunks -> generate answer. */
  async* query(
    question: string,
    topK = 5,
    signal?: AbortSignal,
  ): AsyncGenerator<{ type: 'context'; chunks: Array<{ chunk: DocChunk; score: number }> } | { type: 'token'; text: string }> {
    // 1. Embed the question
    const [queryEmbedding] = await ollamaEmbed([question], EMBED_MODEL);

    // 2. Retrieve relevant chunks
    const results = this.store.search(queryEmbedding, topK);
    yield { type: 'context', chunks: results };

    // 3. Build context string
    const context = results
      .filter(r => r.score > 0.3)
      .map((r, i) => `[Source ${i + 1}: ${r.chunk.metadata.source} (chunk ${r.chunk.metadata.chunkIndex + 1}/${r.chunk.metadata.totalChunks})]:\n${r.chunk.text}`)
      .join('\n\n---\n\n');

    // 4. Generate answer with context
    const messages: OllamaChatMessage[] = [
      {
        role: 'system',
        content: `You are a helpful AI assistant. Answer questions based on the provided context from uploaded documents. If the context doesn't contain relevant information, say so honestly. Always cite which source you're referencing. Be concise and accurate.`,
      },
      {
        role: 'user',
        content: context
          ? `Context from documents:\n\n${context}\n\n---\n\nQuestion: ${question}`
          : `No relevant context was found in the uploaded documents. Question: ${question}`,
      },
    ];

    const stream = streamOllamaChat({
      model: this.chatModel,
      messages,
      temperature: 0.4,
      maxTokens: 1024,
      signal,
    });

    for await (const token of stream) {
      yield { type: 'token', text: token };
    }
  }

  /** Remove a source from the store. */
  removeSource(source: string) {
    this.store.removeSource(source);
  }

  /** Clear all stored data. */
  clear() {
    this.store.clear();
  }
}
