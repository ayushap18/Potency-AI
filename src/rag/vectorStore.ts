/**
 * vectorStore.ts — In-memory vector store with cosine similarity search.
 * Stores document chunks + their embeddings, supports semantic retrieval.
 */

import type { DocChunk } from './chunker';

interface StoredEntry {
  chunk: DocChunk;
  embedding: number[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class VectorStore {
  private entries: StoredEntry[] = [];

  get size() { return this.entries.length; }

  /** Add chunks with their pre-computed embeddings. */
  addChunks(chunks: DocChunk[], embeddings: number[][]) {
    if (chunks.length !== embeddings.length) {
      throw new Error('Chunks and embeddings length mismatch');
    }
    for (let i = 0; i < chunks.length; i++) {
      this.entries.push({ chunk: chunks[i], embedding: embeddings[i] });
    }
  }

  /** Search for the most similar chunks to the query embedding. */
  search(queryEmbedding: number[], topK = 5): Array<{ chunk: DocChunk; score: number }> {
    const scored = this.entries.map(entry => ({
      chunk: entry.chunk,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  /** Remove all chunks from a specific source. */
  removeSource(source: string) {
    this.entries = this.entries.filter(e => e.chunk.metadata.source !== source);
  }

  /** Get all unique source names. */
  getSources(): string[] {
    return [...new Set(this.entries.map(e => e.chunk.metadata.source))];
  }

  /** Clear all entries. */
  clear() {
    this.entries = [];
  }
}
