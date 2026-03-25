export type YouTubeTranscriptErrorCode =
  | 'INVALID_VIDEO_ID'
  | 'VIDEO_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NO_TRANSCRIPT'
  | 'LANGUAGE_NOT_AVAILABLE'
  | 'REQUEST_FAILED';

export class YouTubeTranscriptError extends Error {
  readonly code: YouTubeTranscriptErrorCode;
  readonly videoId?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: YouTubeTranscriptErrorCode,
    message: string,
    options: {
      videoId?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = 'YouTubeTranscriptError';
    this.code = code;
    this.videoId = options.videoId;
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface YouTubeTranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

export interface YouTubeTranscriptResult {
  videoId: string;
  title: string | null;
  languageCode: string;
  languageLabel: string | null;
  isGenerated: boolean;
  source: 'youtube_caption_track';
  fullText: string;
  segments: YouTubeTranscriptSegment[];
  availableLanguageCodes?: string[];
  channelName?: string | null;
  duration?: number | null;
}

export interface FetchYouTubeTranscriptOptions {
  language?: string;
  languages?: string[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  userAgent?: string;
  hl?: string;
  cache?: TranscriptCache<YouTubeTranscriptResult>;
}

export interface TranscriptCache<T> {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  delete(key: string): void;
  clear(): void;
}

export interface InMemoryTranscriptCacheOptions {
  ttlMs?: number;
}

export class InMemoryTranscriptCache<T> implements TranscriptCache<T> {
  private readonly store = new Map<string, { value: T; expiresAt: number | null }>();
  private readonly ttlMs: number | null;

  constructor(options: InMemoryTranscriptCacheOptions = {}) {
    this.ttlMs =
      typeof options.ttlMs === 'number' && options.ttlMs > 0
        ? options.ttlMs
        : null;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.store.set(key, {
      value,
      expiresAt: this.ttlMs === null ? null : Date.now() + this.ttlMs,
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
  name?: {
    simpleText?: string;
    runs?: Array<{ text?: string }>;
  };
}

interface PlayerResponseShape {
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
  videoDetails?: {
    title?: string;
    author?: string;
    lengthSeconds?: string;
  };
}

const WATCH_URL = 'https://www.youtube.com/watch?v=';
const PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const URL_VIDEO_ID_PATTERN =
  /(?:v=|\/embed\/|\/shorts\/|\/live\/|youtu\.be\/)([A-Za-z0-9_-]{11})(?:[?&/]|$)/i;
const XML_TEXT_PATTERN =
  /<text\b[^>]*start="([^"]+)"[^>]*dur="([^"]+)"[^>]*>([\s\S]*?)<\/text>/g;
const XML_PARAGRAPH_PATTERN =
  /<p\b[^>]*t="([^"]+)"[^>]*d="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g;

export async function fetchYouTubeTranscript(
  input: string,
  options: FetchYouTubeTranscriptOptions = {},
): Promise<YouTubeTranscriptResult> {
  const videoId = extractVideoId(input);
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestedLanguages = normalizeRequestedLanguages(options);
  const hl = options.hl?.trim() || requestedLanguages[0] || 'en';
  const cacheKey = buildTranscriptCacheKey(videoId, requestedLanguages, hl);
  const cachedResult = options.cache?.get(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }

  let watchHtml: string;
  try {
    const watchResponse = await fetchImpl(buildWatchUrl(videoId, hl), {
      method: 'GET',
      headers: {
        Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'Accept-Language': hl,
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
      },
      signal: options.signal,
    });

    if (!watchResponse.ok) {
      throw new YouTubeTranscriptError(
        'VIDEO_UNAVAILABLE',
        `Failed to load the YouTube watch page (${watchResponse.status}).`,
        { videoId },
      );
    }

    watchHtml = await watchResponse.text();
  } catch (error) {
    if (error instanceof YouTubeTranscriptError) {
      throw error;
    }
    throw new YouTubeTranscriptError(
      'REQUEST_FAILED',
      'Failed to fetch the YouTube watch page.',
      { videoId, cause: error },
    );
  }

  if (looksRateLimited(watchHtml)) {
    throw new YouTubeTranscriptError(
      'RATE_LIMITED',
      'YouTube is rate-limiting transcript requests right now.',
      { videoId },
    );
  }

  const initialPlayerResponse = extractInitialPlayerResponse(watchHtml);
  const apiKey = extractInnertubeApiKey(watchHtml);
  const playerResponse = apiKey
    ? await fetchPlayerResponse(videoId, apiKey, hl, options)
    : initialPlayerResponse;

  if (!playerResponse) {
    throw new YouTubeTranscriptError(
      'NO_TRANSCRIPT',
      'Could not find YouTube transcript metadata for this video.',
      { videoId },
    );
  }

  const title =
    playerResponse.videoDetails?.title?.trim() ||
    extractTitleFromWatchHtml(watchHtml);
  const tracks =
    playerResponse.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  if (!tracks.length) {
    throw new YouTubeTranscriptError(
      'NO_TRANSCRIPT',
      'This video does not expose a transcript.',
      { videoId },
    );
  }

  const selectedTrack = selectTrack(tracks, requestedLanguages, videoId);
  const transcriptUrl = sanitizeTranscriptUrl(selectedTrack.baseUrl);
  const transcriptXml = await fetchTranscriptXml(
    transcriptUrl,
    options,
    selectedTrack.languageCode || hl,
  );
  const segments = parseTranscriptXml(transcriptXml);

  if (!segments.length) {
    throw new YouTubeTranscriptError(
      'NO_TRANSCRIPT',
      'Transcript track was found but did not return any readable text.',
      { videoId },
    );
  }

  const result: YouTubeTranscriptResult = {
    videoId,
    title,
    languageCode: selectedTrack.languageCode || hl,
    languageLabel: getTrackLabel(selectedTrack),
    isGenerated: selectedTrack.kind === 'asr',
    source: 'youtube_caption_track',
    fullText: segments.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim(),
    segments,
    availableLanguageCodes: tracks.map(track => track.languageCode).filter(Boolean) as string[],
    channelName: playerResponse.videoDetails?.author?.trim() || null,
    duration: normalizeNumericValue(playerResponse.videoDetails?.lengthSeconds),
  };
  options.cache?.set(cacheKey, result);
  return result;
}

export function extractVideoId(input: string): string {
  const trimmed = input.trim();
  if (VIDEO_ID_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const matched = normalized.match(URL_VIDEO_ID_PATTERN);
  if (matched?.[1]) {
    return matched[1];
  }

  throw new YouTubeTranscriptError(
    'INVALID_VIDEO_ID',
    'Expected a valid YouTube URL or 11-character video ID.',
  );
}

function normalizeRequestedLanguages(
  options: FetchYouTubeTranscriptOptions,
): string[] {
  const values = [
    ...(options.languages ?? []),
    ...(options.language ? [options.language] : []),
  ];

  return values
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
}

function buildWatchUrl(videoId: string, hl: string): string {
  const url = new URL(`${WATCH_URL}${videoId}`);
  url.searchParams.set('hl', hl);
  url.searchParams.set('persist_hl', '1');
  return url.toString();
}

async function fetchPlayerResponse(
  videoId: string,
  apiKey: string,
  hl: string,
  options: FetchYouTubeTranscriptOptions,
): Promise<PlayerResponseShape> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${PLAYER_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'ANDROID',
            clientVersion: '20.10.38',
            hl,
          },
        },
        videoId,
      }),
      signal: options.signal,
    });
  } catch (error) {
    throw new YouTubeTranscriptError(
      'REQUEST_FAILED',
      'Failed to fetch YouTube player metadata.',
      { videoId, cause: error },
    );
  }

  if (!response.ok) {
    throw new YouTubeTranscriptError(
      'REQUEST_FAILED',
      `Failed to fetch YouTube player metadata (${response.status}).`,
      { videoId },
    );
  }

  return (await response.json()) as PlayerResponseShape;
}

function extractInitialPlayerResponse(html: string): PlayerResponseShape | null {
  const markerMatch = html.match(/ytInitialPlayerResponse\s*=\s*(\{)/);
  if (!markerMatch || typeof markerMatch.index !== 'number') {
    return null;
  }

  const jsonStart = markerMatch.index + markerMatch[0].length - 1;
  const jsonBody = extractBalancedJson(html, jsonStart);
  if (!jsonBody) {
    return null;
  }

  try {
    return JSON.parse(jsonBody) as PlayerResponseShape;
  } catch {
    return null;
  }
}

function extractBalancedJson(source: string, startIndex: number): string | null {
  let braceCount = 0;
  let inString = false;
  let escape = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      braceCount += 1;
    } else if (char === '}') {
      braceCount -= 1;
      if (braceCount === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function extractInnertubeApiKey(html: string): string | null {
  const matched =
    html.match(/"INNERTUBE_API_KEY":"([^"]+)"/) ??
    html.match(/INNERTUBE_API_KEY\\":\\"([^\\"]+)\\"/);
  return matched?.[1] ?? null;
}

function extractTitleFromWatchHtml(html: string): string | null {
  const matched = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!matched?.[1]) {
    return null;
  }

  return decodeXmlEntities(stripHtmlTags(matched[1]))
    .replace(/\s+-\s+YouTube\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksRateLimited(html: string): boolean {
  return (
    html.includes('g-recaptcha') ||
    html.includes('Our systems have detected unusual traffic')
  );
}

export function selectTrack(
  tracks: CaptionTrack[],
  requestedLanguages: string[],
  videoId: string,
): CaptionTrack {
  const normalizedTracks = tracks.filter(
    track => typeof track.baseUrl === 'string' && track.baseUrl.length > 0,
  );

  if (!normalizedTracks.length) {
    throw new YouTubeTranscriptError(
      'NO_TRANSCRIPT',
      'No usable transcript tracks were returned by YouTube.',
      { videoId },
    );
  }

  if (!requestedLanguages.length) {
    return (
      normalizedTracks.find(track => track.kind !== 'asr') ??
      normalizedTracks[0]
    );
  }

  const exact = findTrackByLanguage(normalizedTracks, requestedLanguages, true);
  if (exact) {
    return exact;
  }

  const loose = findTrackByLanguage(normalizedTracks, requestedLanguages, false);
  if (loose) {
    return loose;
  }

  throw new YouTubeTranscriptError(
    'LANGUAGE_NOT_AVAILABLE',
    'Requested transcript language was not available.',
    {
      videoId,
      details: {
        requestedLanguages,
        availableLanguages: normalizedTracks.map(track => track.languageCode).filter(Boolean),
      },
    },
  );
}

function findTrackByLanguage(
  tracks: CaptionTrack[],
  requestedLanguages: string[],
  exact: boolean,
): CaptionTrack | null {
  for (const requested of requestedLanguages) {
    const matching = tracks.filter(track => {
      const languageCode = track.languageCode?.toLowerCase();
      if (!languageCode) {
        return false;
      }
      if (exact) {
        return languageCode === requested;
      }
      return (
        languageCode === requested ||
        languageCode.split('-')[0] === requested.split('-')[0]
      );
    });

    if (matching.length) {
      return matching.find(track => track.kind !== 'asr') ?? matching[0];
    }
  }

  return null;
}

function sanitizeTranscriptUrl(url: string | undefined): string {
  if (!url) {
    throw new YouTubeTranscriptError(
      'NO_TRANSCRIPT',
      'Transcript track did not include a download URL.',
    );
  }

  return url.replace(/&fmt=[^&]+/g, '');
}

async function fetchTranscriptXml(
  url: string,
  options: FetchYouTubeTranscriptOptions,
  language: string,
): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        'Accept-Language': language,
        'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
      },
      signal: options.signal,
    });
  } catch (error) {
    throw new YouTubeTranscriptError(
      'REQUEST_FAILED',
      'Failed to fetch transcript XML.',
      { cause: error },
    );
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new YouTubeTranscriptError(
        'RATE_LIMITED',
        'Transcript request was rate-limited by YouTube.',
      );
    }

    throw new YouTubeTranscriptError(
      'REQUEST_FAILED',
      `Failed to fetch transcript XML (${response.status}).`,
    );
  }

  return response.text();
}

export function parseTranscriptXml(xml: string): YouTubeTranscriptSegment[] {
  const segments: YouTubeTranscriptSegment[] = [];

  for (const matched of xml.matchAll(XML_TEXT_PATTERN)) {
    const offset = Number.parseFloat(matched[1] ?? '0');
    const duration = Number.parseFloat(matched[2] ?? '0');
    const decodedText = decodeXmlEntities(stripHtmlTags(matched[3] ?? ''))
      .replace(/\s+/g, ' ')
      .trim();

    if (!decodedText) {
      continue;
    }

    segments.push({
      text: decodedText,
      offset: Number.isFinite(offset) ? offset : 0,
      duration: Number.isFinite(duration) ? duration : 0,
    });
  }

  if (segments.length) {
    return segments;
  }

  for (const matched of xml.matchAll(XML_PARAGRAPH_PATTERN)) {
    const offsetMs = Number.parseFloat(matched[1] ?? '0');
    const durationMs = Number.parseFloat(matched[2] ?? '0');
    const decodedText = decodeXmlEntities(stripHtmlTags(matched[3] ?? ''))
      .replace(/\s+/g, ' ')
      .trim();

    if (!decodedText) {
      continue;
    }

    segments.push({
      text: decodedText,
      offset: Number.isFinite(offsetMs) ? offsetMs / 1000 : 0,
      duration: Number.isFinite(durationMs) ? durationMs / 1000 : 0,
    });
  }

  return segments;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );
}

function getTrackLabel(track: CaptionTrack): string | null {
  return (
    track.name?.simpleText?.trim() ||
    track.name?.runs?.map(run => run.text?.trim()).filter(Boolean).join(' ').trim() ||
    null
  );
}

function buildTranscriptCacheKey(
  videoId: string,
  requestedLanguages: string[],
  hl: string,
): string {
  return JSON.stringify({
    videoId,
    requestedLanguages,
    hl,
  });
}

function normalizeNumericValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type TranscriptLike = YouTubeTranscriptResult | YouTubeTranscriptSegment[];

function toSegments(transcript: TranscriptLike): YouTubeTranscriptSegment[] {
  return Array.isArray(transcript) ? transcript : transcript.segments;
}

export interface SearchTranscriptOptions {
  caseSensitive?: boolean;
  maxResults?: number;
  contextChars?: number;
}

export interface TranscriptSearchMatch {
  text: string;
  segmentIndex: number;
  startTimestamp: number;
  duration: number;
  contextBefore: string;
  contextAfter: string;
}

export function searchTranscript(
  transcript: TranscriptLike,
  query: string,
  options: SearchTranscriptOptions = {},
): TranscriptSearchMatch[] {
  const normalizedQuery = options.caseSensitive ? query : query.toLowerCase();
  if (!normalizedQuery.trim()) {
    return [];
  }

  const maxResults = options.maxResults && options.maxResults > 0 ? options.maxResults : Number.POSITIVE_INFINITY;
  const contextChars = options.contextChars ?? 24;
  const matches: TranscriptSearchMatch[] = [];

  for (const [segmentIndex, segment] of toSegments(transcript).entries()) {
    const haystack = options.caseSensitive ? segment.text : segment.text.toLowerCase();
    let fromIndex = 0;
    while (fromIndex < haystack.length) {
      const foundAt = haystack.indexOf(normalizedQuery, fromIndex);
      if (foundAt < 0) {
        break;
      }
      const endIndex = foundAt + normalizedQuery.length;
      matches.push({
        text: segment.text.slice(foundAt, endIndex),
        segmentIndex,
        startTimestamp: segment.offset,
        duration: segment.duration,
        contextBefore: segment.text.slice(Math.max(0, foundAt - contextChars), foundAt),
        contextAfter: segment.text.slice(endIndex, endIndex + contextChars),
      });
      if (matches.length >= maxResults) {
        return matches;
      }
      fromIndex = endIndex || foundAt + 1;
    }
  }

  return matches;
}

export interface ChunkTranscriptOptions {
  maxChars?: number;
  maxTokens?: number;
  overlapSegments?: number;
  mergeAdjacentShortSegments?: boolean;
  shortSegmentChars?: number;
}

export interface TranscriptChunk {
  chunkIndex: number;
  text: string;
  approximateLength: {
    chars: number;
    tokens: number;
  };
  startTimestamp: number | null;
  endTimestamp: number | null;
  segmentIndexes: number[];
}

export function chunkTranscript(
  transcript: TranscriptLike,
  options: ChunkTranscriptOptions = {},
): TranscriptChunk[] {
  const sourceSegments = toSegments(transcript);
  const segments = options.mergeAdjacentShortSegments
    ? mergeTinyBrokenSegments(sourceSegments, options.shortSegmentChars ?? 20)
    : sourceSegments.map(segment => ({ ...segment }));
  const overlap = Math.max(0, options.overlapSegments ?? 0);
  const maxChars = options.maxChars && options.maxChars > 0 ? options.maxChars : Number.POSITIVE_INFINITY;
  const maxTokens = options.maxTokens && options.maxTokens > 0 ? options.maxTokens : Number.POSITIVE_INFINITY;

  const chunks: TranscriptChunk[] = [];
  let cursor = 0;
  while (cursor < segments.length) {
    const chunkSegments: Array<{ segment: YouTubeTranscriptSegment; index: number }> = [];
    let chars = 0;
    let tokens = 0;
    let nextCursor = cursor;
    while (nextCursor < segments.length) {
      const candidate = segments[nextCursor];
      const candidateChars = candidate.text.length + (chunkSegments.length ? 1 : 0);
      const candidateTokens = approximateTokens(candidate.text);
      if (
        chunkSegments.length > 0 &&
        (chars + candidateChars > maxChars || tokens + candidateTokens > maxTokens)
      ) {
        break;
      }
      chunkSegments.push({ segment: candidate, index: nextCursor });
      chars += candidateChars;
      tokens += candidateTokens;
      nextCursor += 1;
    }

    if (!chunkSegments.length) {
      const forced = segments[nextCursor];
      chunkSegments.push({ segment: forced, index: nextCursor });
      nextCursor += 1;
    }

    const first = chunkSegments[0].segment;
    const last = chunkSegments[chunkSegments.length - 1].segment;
    chunks.push({
      chunkIndex: chunks.length,
      text: chunkSegments.map(item => item.segment.text).join(' ').trim(),
      approximateLength: {
        chars: chunkSegments.map(item => item.segment.text).join(' ').length,
        tokens: chunkSegments.reduce((sum, item) => sum + approximateTokens(item.segment.text), 0),
      },
      startTimestamp: Number.isFinite(first.offset) ? first.offset : null,
      endTimestamp: Number.isFinite(last.offset + last.duration) ? last.offset + last.duration : null,
      segmentIndexes: chunkSegments.map(item => item.index),
    });

    const overlappedCursor = nextCursor - overlap;
    cursor = overlappedCursor > cursor ? overlappedCursor : cursor + 1;
  }

  return chunks;
}

function approximateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export type TranscriptFormatMode = 'segments' | 'plainText' | 'markdown' | 'paragraphs';

export interface FormatTranscriptOptions {
  mode?: TranscriptFormatMode;
  includeTimestamps?: boolean;
  paragraphMergeThresholdSec?: number;
  separator?: string;
}

export interface TranscriptParagraph {
  text: string;
  startTimestamp: number;
  endTimestamp: number;
  segmentIndexes: number[];
}

export function formatTranscript(
  transcript: TranscriptLike,
  options: FormatTranscriptOptions = {},
): YouTubeTranscriptSegment[] | string | TranscriptParagraph[] {
  const segments = toSegments(transcript);
  const mode = options.mode ?? 'plainText';
  const separator = options.separator ?? ' ';

  if (mode === 'segments') {
    return segments.map(segment => ({ ...segment }));
  }

  if (mode === 'plainText') {
    return segments.map(segment => segment.text).join(separator).replace(/\s+/g, ' ').trim();
  }

  if (mode === 'markdown') {
    return segments
      .map(segment => {
        if (!options.includeTimestamps) {
          return `- ${segment.text}`;
        }
        return `- [${formatTimestamp(segment.offset)}] ${segment.text}`;
      })
      .join('\n');
  }

  const paragraphs = buildParagraphs(segments, options.paragraphMergeThresholdSec ?? 1.5);
  if (!options.includeTimestamps) {
    return paragraphs;
  }
  return paragraphs.map(paragraph => ({
    ...paragraph,
    text: `[${formatTimestamp(paragraph.startTimestamp)} - ${formatTimestamp(paragraph.endTimestamp)}] ${paragraph.text}`,
  }));
}

function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function buildParagraphs(
  segments: YouTubeTranscriptSegment[],
  mergeThresholdSec: number,
): TranscriptParagraph[] {
  const paragraphs: TranscriptParagraph[] = [];
  for (const [index, segment] of segments.entries()) {
    const previous = paragraphs[paragraphs.length - 1];
    if (!previous) {
      paragraphs.push({
        text: segment.text,
        startTimestamp: segment.offset,
        endTimestamp: segment.offset + segment.duration,
        segmentIndexes: [index],
      });
      continue;
    }
    const gap = segment.offset - previous.endTimestamp;
    if (gap <= mergeThresholdSec) {
      previous.text = `${previous.text} ${segment.text}`.replace(/\s+/g, ' ').trim();
      previous.endTimestamp = segment.offset + segment.duration;
      previous.segmentIndexes.push(index);
    } else {
      paragraphs.push({
        text: segment.text,
        startTimestamp: segment.offset,
        endTimestamp: segment.offset + segment.duration,
        segmentIndexes: [index],
      });
    }
  }
  return paragraphs;
}

export interface CleanTranscriptTextOptions {
  normalizeWhitespace?: boolean;
  stripBracketedMarkers?: boolean;
  dedupeAdjacentLines?: boolean;
}

export function cleanTranscriptText(
  input: string | TranscriptLike,
  options: CleanTranscriptTextOptions = {},
): string {
  const segments = typeof input === 'string' ? [{ text: input, offset: 0, duration: 0 }] : toSegments(input);
  const cleanedSegments = cleanTranscriptSegments(segments, options);
  return cleanedSegments.map(segment => segment.text).join(' ').trim();
}

export function cleanTranscriptSegments(
  segments: YouTubeTranscriptSegment[],
  options: CleanTranscriptTextOptions = {},
): YouTubeTranscriptSegment[] {
  const normalized: YouTubeTranscriptSegment[] = [];
  for (const segment of segments) {
    let text = segment.text;
    if (options.stripBracketedMarkers) {
      text = text.replace(/\[(music|applause|laughter|noise|silence|intro music)\]/gi, ' ');
    }
    if (options.normalizeWhitespace !== false) {
      text = text.replace(/\s+/g, ' ').trim();
    }
    if (!text) {
      continue;
    }
    if (
      options.dedupeAdjacentLines &&
      normalized.length > 0 &&
      normalized[normalized.length - 1].text.toLowerCase() === text.toLowerCase()
    ) {
      continue;
    }
    normalized.push({ ...segment, text });
  }
  return mergeTinyBrokenSegments(normalized, 6);
}

function mergeTinyBrokenSegments(
  segments: YouTubeTranscriptSegment[],
  tinyLength: number,
): YouTubeTranscriptSegment[] {
  const merged: YouTubeTranscriptSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && (previous.text.length <= tinyLength || segment.text.length <= tinyLength)) {
      previous.text = `${previous.text} ${segment.text}`.replace(/\s+/g, ' ').trim();
      previous.duration = (segment.offset + segment.duration) - previous.offset;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

export interface GetTranscriptWithMetadataOptions extends FetchYouTubeTranscriptOptions {}

export interface TranscriptWithMetadata {
  title: string | null;
  videoId: string;
  channelName: string | null;
  duration: number | null;
  publishedDate: string | null;
  thumbnailUrls: string[];
  availableLanguages: string[];
  selectedLanguage: {
    code: string;
    label: string | null;
  };
  isGenerated: boolean;
  segments: YouTubeTranscriptSegment[];
  fullText: string;
}

export async function getTranscriptWithMetadata(
  input: string | YouTubeTranscriptResult,
  options: GetTranscriptWithMetadataOptions = {},
): Promise<TranscriptWithMetadata> {
  const transcript = typeof input === 'string' ? await fetchYouTubeTranscript(input, options) : input;
  const thumbnails = [
    `https://i.ytimg.com/vi/${transcript.videoId}/default.jpg`,
    `https://i.ytimg.com/vi/${transcript.videoId}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${transcript.videoId}/hqdefault.jpg`,
  ];

  return {
    title: transcript.title,
    videoId: transcript.videoId,
    channelName: transcript.channelName ?? null,
    duration: transcript.duration ?? null,
    publishedDate: null,
    thumbnailUrls: thumbnails,
    availableLanguages: transcript.availableLanguageCodes ?? [],
    selectedLanguage: {
      code: transcript.languageCode,
      label: transcript.languageLabel,
    },
    isGenerated: transcript.isGenerated,
    segments: transcript.segments,
    fullText: transcript.fullText,
  };
}

export interface FetchManyYouTubeTranscriptsOptions extends FetchYouTubeTranscriptOptions {
  concurrency?: number;
}

export type FetchManyResultItem =
  | { input: string; success: true; result: YouTubeTranscriptResult }
  | { input: string; success: false; error: YouTubeTranscriptError };

export async function fetchManyYouTubeTranscripts(
  inputs: string[],
  options: FetchManyYouTubeTranscriptsOptions = {},
): Promise<FetchManyResultItem[]> {
  const results: FetchManyResultItem[] = new Array(inputs.length);
  const concurrency = Math.max(1, options.concurrency ?? 3);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    while (cursor < inputs.length) {
      const index = cursor;
      cursor += 1;
      const input = inputs[index];
      try {
        const result = await fetchYouTubeTranscript(input, options);
        results[index] = { input, success: true, result };
      } catch (error) {
        const normalizedError =
          error instanceof YouTubeTranscriptError
            ? error
            : new YouTubeTranscriptError('REQUEST_FAILED', 'Batch transcript request failed.', {
                cause: error,
              });
        results[index] = { input, success: false, error: normalizedError };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, () => worker()));
  return results;
}
