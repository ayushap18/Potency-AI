/**
 * retrieval.ts — Local retrieval using the Wikipedia REST API (CORS-enabled).
 * Falls back to a no-source context if Wikipedia is unreachable.
 * 
 * No API key needed. Wikipedia allows cross-origin requests from any origin.
 */

export interface RetrievedSource {
  title: string;
  url: string;
  content: string;
  type: 'wikipedia' | 'knowledge';
}

const WIKI_API = 'https://en.wikipedia.org/api/rest_v1';
const WIKI_SEARCH = 'https://en.wikipedia.org/w/api.php';
const WIKI_TIMEOUT_MS = 10000; // 10 seconds - increased for slow connections

/**
 * Create an AbortSignal that times out after the specified duration,
 * but also respects an external abort signal.
 */
function createCombinedSignal(timeoutMs: number, externalSignal?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort();
      });
    }
  }
  
  return controller.signal;
}

/**
 * Search Wikipedia and return the top article summaries.
 */
async function searchWikipedia(
  query: string, 
  maxResults = 3,
  signal?: AbortSignal,
): Promise<RetrievedSource[]> {
  try {
    const combinedSignal = createCombinedSignal(WIKI_TIMEOUT_MS, signal);
    
    // Step 1: search for article titles
    const searchUrl = `${WIKI_SEARCH}?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${maxResults}`;
    const searchResp = await fetch(searchUrl, { signal: combinedSignal });
    if (!searchResp.ok) return [];
    const searchData = await searchResp.json() as { query: { search: { title: string }[] } };
    const titles = searchData.query?.search?.map((s) => s.title) ?? [];
    if (titles.length === 0) return [];

    // Step 2: fetch summaries for each title in parallel
    const summaries = await Promise.allSettled(
      titles.slice(0, maxResults).map(async (title) => {
        const summarySignal = createCombinedSignal(WIKI_TIMEOUT_MS, signal);
        const summaryUrl = `${WIKI_API}/page/summary/${encodeURIComponent(title)}`;
        const resp = await fetch(summaryUrl, { signal: summarySignal });
        if (!resp.ok) return null;
        const data = await resp.json() as {
          title: string;
          extract: string;
          content_urls: { desktop: { page: string } };
        };
        if (!data.extract) return null;
        return {
          title: data.title,
          url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
          content: data.extract.slice(0, 1200), // cap per source — smaller for faster LLM processing
          type: 'wikipedia' as const,
        };
      }),
    );

    return summaries.reduce<RetrievedSource[]>((acc, r) => {
      if (r.status === 'fulfilled' && r.value !== null) {
        acc.push(r.value);
      }
      return acc;
    }, []);
  } catch (err) {
    // Log but don't throw - let caller handle empty results
    if (err instanceof Error && err.name === 'AbortError') {
      console.log('[retrieval] Wikipedia search aborted');
    } else {
      console.warn('[retrieval] Wikipedia search failed:', err);
    }
    return [];
  }
}

export interface RetrievalPlan {
  queries: string[];
}

/**
 * Retrieve sources for a list of search queries.
 * Deduplicates results by title.
 */
export async function retrieveSources(
  queries: string[],
  maxPerQuery = 2,
  signal?: AbortSignal,
): Promise<RetrievedSource[]> {
  // Check if aborted before starting
  if (signal?.aborted) return [];
  
  const allResults = await Promise.allSettled(
    queries.slice(0, 4).map((q) => searchWikipedia(q, maxPerQuery, signal)),
  );

  const seen = new Set<string>();
  const sources: RetrievedSource[] = [];

  for (const result of allResults) {
    if (result.status !== 'fulfilled') continue;
    for (const src of result.value) {
      if (!seen.has(src.title)) {
        seen.add(src.title);
        sources.push(src);
      }
    }
  }

  return sources.slice(0, 8); // cap total
}

/** Format sources as a compact string for the LLM prompt. */
export function formatSourcesForPrompt(sources: RetrievedSource[]): string {
  if (sources.length === 0) return 'No external sources retrieved. Use your training knowledge.';
  return sources
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.content}`)
    .join('\n\n---\n\n');
}
