import { YouTubeTranscriptError } from './errors.js';
import { DEFAULT_USER_AGENT, extractBalancedJson, looksRateLimited } from './utils.js';

export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  channelName: string;
  channelId: string | null;
  publishedAt: string | null;
  viewCount: string | null;
  duration: string | null;
  durationSeconds: number | null;
  thumbnailUrl: string;
  description: string;
  url: string;
}

export interface SearchYouTubeOptions {
  /** Search query string */
  query: string;
  /** Maximum number of results to return (default: 20) */
  maxResults?: number;
  /** Preferred language for search results (default: 'en') */
  hl?: string;
  /** Custom fetch implementation */
  fetchImpl?: typeof fetch;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Custom User-Agent */
  userAgent?: string;
}

const SEARCH_URL = 'https://www.youtube.com/results';

function normalizeText(runs?: Array<{ text?: string }>): string {
  if (!runs?.length) return '';
  return runs.map(r => r.text ?? '').join('').trim();
}

function parseDurationToSeconds(duration: string | null): number | null {
  if (!duration) return null;
  const parts = duration.split(':').map(Number);
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return parts[0] ?? null;
}

function walkRenderers(
  node: unknown,
  targetType: string,
  results: unknown[] = [],
): unknown[] {
  if (!node || typeof node !== 'object') return results;

  if (Array.isArray(node)) {
    for (const item of node) {
      walkRenderers(item, targetType, results);
    }
    return results;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === targetType) {
      results.push(value);
    } else {
      walkRenderers(value, targetType, results);
    }
  }

  return results;
}

function parseSearchResults(initialData: unknown): YouTubeSearchResult[] {
  const results: YouTubeSearchResult[] = [];

  const videoRenderers = walkRenderers(initialData, 'videoRenderer', []);

  for (const renderer of videoRenderers) {
    if (!renderer || typeof renderer !== 'object') continue;
    const r = renderer as Record<string, unknown>;

    const videoId = (r.videoId as string) || '';
    if (!videoId) continue;

    const titleRuns = (r.title as Record<string, unknown>)?.runs as Array<{ text?: string }> | undefined;
    const title = normalizeText(titleRuns);
    if (!title) continue;

    const ownerTextRuns = (r.ownerText as Record<string, unknown>)?.runs as Array<{ text?: string; navigationEndpoint?: { browseEndpoint?: { browseId?: string } } }> | undefined;
    const channelName = normalizeText(ownerTextRuns);
    const channelId = ownerTextRuns?.[0]?.navigationEndpoint?.browseEndpoint?.browseId ?? null;

    const publishedTimeText = (r.publishedTimeText as Record<string, unknown>)?.simpleText as string | undefined;
    const viewCountText = (r.viewCountText as Record<string, unknown>)?.simpleText as string | undefined;
    const lengthText = (r.lengthText as Record<string, unknown>)?.simpleText as string | undefined;

    const descriptionSnippetRuns = (r.detailedMetadataSnippets as Array<{ snippetText?: { runs?: Array<{ text?: string }> } }> | undefined)?.[0]?.snippetText?.runs;
    const description = normalizeText(descriptionSnippetRuns) || normalizeText((r.descriptionSnippet as Record<string, unknown>)?.runs as Array<{ text?: string }> | undefined);

    const thumbnails = (r.thumbnail as Record<string, unknown>)?.thumbnails as Array<{ url?: string }> | undefined;
    const thumbnailUrl = thumbnails?.[thumbnails.length - 1]?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    results.push({
      videoId,
      title,
      channelName,
      channelId,
      publishedAt: publishedTimeText ?? null,
      viewCount: viewCountText ?? null,
      duration: lengthText ?? null,
      durationSeconds: parseDurationToSeconds(lengthText ?? null),
      thumbnailUrl,
      description,
      url: `https://www.youtube.com/watch?v=${videoId}`,
    });
  }

  return results;
}

/**
 * Search YouTube for videos without using the official YouTube Data API.
 * Scrapes the YouTube search results page and extracts video metadata.
 *
 * @example
 * ```ts
 * const results = await searchYouTube({ query: 'typescript tutorial', maxResults: 10 });
 * console.log(results[0].title, results[0].videoId);
 * ```
 */
export async function searchYouTube(
  options: SearchYouTubeOptions,
): Promise<YouTubeSearchResult[]> {
  const {
    query,
    maxResults = 20,
    hl = 'en',
    fetchImpl = fetch,
    signal,
    userAgent,
  } = options;

  if (!query.trim()) {
    throw new YouTubeTranscriptError('EMPTY_QUERY', 'Search query cannot be empty.');
  }

  const url = new URL(SEARCH_URL);
  url.searchParams.set('search_query', query.trim());
  url.searchParams.set('hl', hl);
  url.searchParams.set('persist_hl', '1');

  let html: string;
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': hl,
        'User-Agent': userAgent || DEFAULT_USER_AGENT,
      },
      signal,
    });

    if (!response.ok) {
      throw new YouTubeTranscriptError(
        'SEARCH_FAILED',
        `YouTube search returned status ${response.status}.`,
      );
    }

    html = await response.text();
  } catch (error) {
    if (error instanceof YouTubeTranscriptError) throw error;
    throw new YouTubeTranscriptError(
      'REQUEST_FAILED',
      'Failed to fetch YouTube search results.',
      { cause: error },
    );
  }

  if (looksRateLimited(html)) {
    throw new YouTubeTranscriptError(
      'RATE_LIMITED',
      'YouTube is rate-limiting search requests right now.',
    );
  }

  const initialData = extractYtInitialData(html);
  if (!initialData) {
    throw new YouTubeTranscriptError(
      'SEARCH_FAILED',
      'Could not parse YouTube search results. The page structure may have changed.',
    );
  }

  const results = parseSearchResults(initialData);
  return results.slice(0, Math.max(1, maxResults));
}

function extractYtInitialData(html: string): unknown | null {
  const markerMatch = html.match(/ytInitialData\s*=\s*(\{)/);
  if (!markerMatch || typeof markerMatch.index !== 'number') {
    return null;
  }

  const jsonStart = markerMatch.index + markerMatch[0].length - 1;
  const jsonBody = extractBalancedJson(html, jsonStart);
  if (!jsonBody) {
    return null;
  }

  try {
    return JSON.parse(jsonBody);
  } catch {
    return null;
  }
}
