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

/**
 * Search Wikipedia and return the top article summaries.
 */
async function searchWikipedia(query: string, maxResults = 3): Promise<RetrievedSource[]> {
  try {
    // Step 1: search for article titles
    const searchUrl = `${WIKI_SEARCH}?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=${maxResults}`;
    const searchResp = await fetch(searchUrl, { signal: AbortSignal.timeout(6000) });
    if (!searchResp.ok) return [];
    const searchData = await searchResp.json() as { query: { search: { title: string }[] } };
    const titles = searchData.query?.search?.map((s) => s.title) ?? [];
    if (titles.length === 0) return [];

    // Step 2: fetch summaries for each title in parallel
    const summaries = await Promise.allSettled(
      titles.slice(0, maxResults).map(async (title) => {
        const summaryUrl = `${WIKI_API}/page/summary/${encodeURIComponent(title)}`;
        const resp = await fetch(summaryUrl, { signal: AbortSignal.timeout(6000) });
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
          content: data.extract.slice(0, 2500), // cap per source
          type: 'wikipedia' as const,
        };
      }),
    );

    return summaries
      .filter((r): r is PromiseFulfilledResult<RetrievedSource | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((v): v is RetrievedSource => v !== null);
  } catch {
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
): Promise<RetrievedSource[]> {
  const allResults = await Promise.allSettled(
    queries.slice(0, 4).map((q) => searchWikipedia(q, maxPerQuery)),
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
