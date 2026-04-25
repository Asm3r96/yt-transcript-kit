export type YouTubeTranscriptErrorCode =
  | 'INVALID_VIDEO_ID'
  | 'VIDEO_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NO_TRANSCRIPT'
  | 'LANGUAGE_NOT_AVAILABLE'
  | 'REQUEST_FAILED'
  | 'EMPTY_QUERY'
  | 'SEARCH_FAILED';

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
