# yt-transcript-kit

[![NPM Version](https://img.shields.io/npm/v/yt-transcript-kit.svg)](https://www.npmjs.com/package/yt-transcript-kit)

Lightweight YouTube transcript extraction for apps that want transcript text first, then decide what to do with it. Built with TypeScript and zero runtime dependencies.

## Install

```bash
npm install yt-transcript-kit
```

## Quick Start

```ts
import { fetchYouTubeTranscript } from 'yt-transcript-kit';

const result = await fetchYouTubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
console.log(result.title, result.fullText);
```

## New APIs

### Transcript Search

```ts
import { searchTranscript } from 'yt-transcript-kit';

const transcript = await fetchYouTubeTranscript('videoId');
const matches = searchTranscript(transcript, 'keyword', {
  caseSensitive: false,
  maxResults: 20,
  contextChars: 24,
});
```

### Chunking for LLM pipelines

```ts
import { chunkTranscript } from 'yt-transcript-kit';

const chunks = chunkTranscript(transcript, {
  maxChars: 4000,
  maxTokens: 1200,
  overlapSegments: 1,
  mergeAdjacentShortSegments: true,
});
```

### Formatting modes

```ts
import { formatTranscript } from 'yt-transcript-kit';

const plainText = formatTranscript(transcript, { mode: 'plainText' });
const markdown = formatTranscript(transcript, { mode: 'markdown', includeTimestamps: true });
const paragraphs = formatTranscript(transcript, { mode: 'paragraphs', paragraphMergeThresholdSec: 2 });
const segments = formatTranscript(transcript, { mode: 'segments' });
```

### Metadata helper

```ts
import { getTranscriptWithMetadata } from 'yt-transcript-kit';

const enriched = await getTranscriptWithMetadata('videoId');
console.log(enriched.channelName, enriched.duration, enriched.thumbnailUrls);
```

### Optional cache support

```ts
import { fetchYouTubeTranscript, InMemoryTranscriptCache } from 'yt-transcript-kit';

const cache = new InMemoryTranscriptCache({ ttlMs: 60_000 });
const transcript = await fetchYouTubeTranscript('videoId', { cache });
```

### Batch fetching

```ts
import { fetchManyYouTubeTranscripts } from 'yt-transcript-kit';

const results = await fetchManyYouTubeTranscripts(['videoId1', 'videoId2'], { concurrency: 3 });
```

### Cleanup helpers

```ts
import { cleanTranscriptText, cleanTranscriptSegments } from 'yt-transcript-kit';

const cleanedText = cleanTranscriptText(transcript, {
  stripBracketedMarkers: true,
  dedupeAdjacentLines: true,
});

const cleanedSegments = cleanTranscriptSegments(transcript.segments, {
  normalizeWhitespace: true,
});
```

## CLI

```bash
npx yt-transcript-kit <url>
npx yt-transcript-kit <url> --format txt
npx yt-transcript-kit <url> --format json
npx yt-transcript-kit <url> --format markdown
npx yt-transcript-kit <url> --languages de,en
npx yt-transcript-kit <url> --search "keyword"
npx yt-transcript-kit <url> --chunks --max-chars 4000
npx yt-transcript-kit batch urls.txt --concurrency 3
```

Use `--help` to print command help.

## Error Codes

`INVALID_VIDEO_ID`, `VIDEO_UNAVAILABLE`, `RATE_LIMITED`, `NO_TRANSCRIPT`, `LANGUAGE_NOT_AVAILABLE`, `REQUEST_FAILED`.

## Development

```bash
npm run build
npm run typecheck
npm run test
```
