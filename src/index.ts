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
}

export interface FetchYouTubeTranscriptOptions {
  language?: string;
  languages?: string[];
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  userAgent?: string;
  hl?: string;
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

  return {
    videoId,
    title,
    languageCode: selectedTrack.languageCode || hl,
    languageLabel: getTrackLabel(selectedTrack),
    isGenerated: selectedTrack.kind === 'asr',
    source: 'youtube_caption_track',
    fullText: segments.map(segment => segment.text).join(' ').replace(/\s+/g, ' ').trim(),
    segments,
  };
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

function selectTrack(
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

function parseTranscriptXml(xml: string): YouTubeTranscriptSegment[] {
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
