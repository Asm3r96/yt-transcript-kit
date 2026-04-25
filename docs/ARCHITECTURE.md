# Architecture & How it Works

`yt-transcript-kit` is designed to be a lightweight, robust, and zero-dependency way to fetch YouTube transcripts and search YouTube video metadata. Since YouTube does not provide a simple public API for transcripts or no-key search, the package uses a hybrid approach of HTML scraping and Internal API (InnerTube) requests.

## Flow Diagram

```mermaid
graph TD
    A[Input: Video ID or URL] --> B[Extract Video ID]
    B --> C[Fetch YouTube Watch Page]
    C --> D{Check Rate Limit}
    D -- Yes --> E[Throw RATE_LIMITED]
    D -- No --> F[Extract ytInitialPlayerResponse & API Key]
    F --> G{API Key Found?}
    G -- Yes --> H[Fetch Detailed Player Info via InnerTube POST]
    G -- No --> I[Fall back to ytInitialPlayerResponse]
    H --> J[Select Best Caption Track]
    I --> J
    J --> K[Fetch XML Transcript Track]
    K --> L[Parse XML to Segments]
    L --> M[Return YouTubeTranscriptResult]
```

## Search Flow

```mermaid
graph TD
    A[Input: Search Query] --> B{Query Empty?}
    B -- Yes --> C[Throw EMPTY_QUERY]
    B -- No --> D[Fetch YouTube Results Page]
    D --> E{Check Rate Limit}
    E -- Yes --> F[Throw RATE_LIMITED]
    E -- No --> G[Extract ytInitialData]
    G --> H{Initial Data Found?}
    H -- No --> I[Throw SEARCH_FAILED]
    H -- Yes --> J[Walk videoRenderer Nodes]
    J --> K[Normalize Video Metadata]
    K --> L[Return YouTubeSearchResult Array]
```

## Core Components

### 1. extraction
- **Video ID Logic**: Handles standard URLs, short URLs, embeds, and raw IDs.
- **Embedded JSON**: Finds `ytInitialPlayerResponse` in the watch page's script tags.
- **InnerTube API**: YouTube's internal API. We extract the `INNERTUBE_API_KEY` to make more reliable requests to the `/v1/player` endpoint.

### 2. Selection Logic
- The library prioritizes non-generated (manual) transcripts.
- It supports language fallback. If you request `fr`, it will try to find an exact match, then a loose match (e.g., `fr-CA`), and finally it will throw a `LANGUAGE_NOT_AVAILABLE` if none exist.

### 3. Parsing
- YouTube transcripts are served in two XML formats (depending on the track).
- We use custom regex-based parsing (`XML_TEXT_PATTERN` and `XML_PARAGRAPH_PATTERN`) to avoid heavy XML parser dependencies, keeping the kit lightweight for browser and React Native environments.
- Text is cleaned: HTML tags are stripped, and XML entities are decoded.

### 4. YouTube Search
- `searchYouTube(...)` fetches the public YouTube results page with a browser-like user agent.
- It extracts `ytInitialData`, walks nested `videoRenderer` nodes, and returns normalized video metadata.
- `searchYouTubeWithTranscripts(...)` composes search with `fetchYouTubeTranscript(...)` when `includeTranscripts` is enabled.
- Search failures use `EMPTY_QUERY`, `SEARCH_FAILED`, `RATE_LIMITED`, or `REQUEST_FAILED` so callers can handle user input, parsing drift, rate limiting, and network errors separately.

## Design Decisions

- **Zero Runtime Dependencies**: Uses native `fetch`. This makes it easy to audit and compatible with almost all modern JS environments (Node 18+, Edge Functions, Browser, React Native).
- **TypeScript First**: All error codes and result shapes are strictly typed.
- **Error Codes**: Uses a custom `YouTubeTranscriptError` class with specific codes (`RATE_LIMITED`, `VIDEO_UNAVAILABLE`, `EMPTY_QUERY`, `SEARCH_FAILED`, etc.) to allow programmatic handling.

## Known Limitations

- **CORS**: In a standard browser, requests to YouTube will fail due to CORS. This library is intended for server-side use, CLIs, or environments where CORS is relaxed (like browser extensions or React Native).
- **Rate Limiting**: Frequent requests from the same IP will eventually trigger a CAPTCHA.
- **YouTube Page Structure**: Search parsing depends on YouTube's public result page shape. If YouTube changes `ytInitialData` or `videoRenderer`, `SEARCH_FAILED` can be thrown until the parser is updated.
