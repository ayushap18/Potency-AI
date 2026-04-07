/**
 * chunker.ts — Split documents into overlapping chunks for RAG embedding.
 */

export interface DocChunk {
  id: string;
  text: string;
  metadata: {
    source: string;
    chunkIndex: number;
    totalChunks: number;
  };
}

const DEFAULT_CHUNK_SIZE = 500;    // characters
const DEFAULT_CHUNK_OVERLAP = 100; // characters

/** Split text into overlapping chunks. */
export function chunkText(
  text: string,
  source: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_CHUNK_OVERLAP,
): DocChunk[] {
  const cleaned = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return [];

  // Split on paragraph boundaries first, then merge into chunks
  const paragraphs = cleaned.split(/\n\n+/);
  const chunks: DocChunk[] = [];
  let current = '';
  let chunkIdx = 0;

  for (const para of paragraphs) {
    if (current.length + para.length + 1 > chunkSize && current.length > 0) {
      chunks.push({
        id: `${source}-${chunkIdx}`,
        text: current.trim(),
        metadata: { source, chunkIndex: chunkIdx, totalChunks: 0 },
      });
      // Keep overlap from end of current chunk
      const overlapText = current.slice(-overlap);
      current = overlapText + '\n\n' + para;
      chunkIdx++;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }

  // Push remaining text
  if (current.trim()) {
    chunks.push({
      id: `${source}-${chunkIdx}`,
      text: current.trim(),
      metadata: { source, chunkIndex: chunkIdx, totalChunks: 0 },
    });
  }

  // Update totalChunks
  for (const c of chunks) c.metadata.totalChunks = chunks.length;

  return chunks;
}

/** Extract text from a File (supports .txt, .md, .json, .csv). */
export async function extractTextFromFile(file: File): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase();

  if (['txt', 'md', 'markdown', 'csv', 'json', 'log', 'py', 'js', 'ts', 'html', 'css', 'yaml', 'yml', 'xml', 'toml'].includes(ext ?? '')) {
    return file.text();
  }

  if (ext === 'pdf') {
    // Basic PDF text extraction - read as text (works for text-based PDFs)
    const text = await file.text();
    // Strip binary PDF content, keep readable text
    return text.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s{3,}/g, ' ').trim();
  }

  return file.text(); // Fallback: try reading as text
}
