# yt-transcript-kit

[![NPM Version](https://img.shields.io/npm/v/yt-transcript-kit.svg)](https://www.npmjs.com/package/yt-transcript-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Issues](https://img.shields.io/github/issues/Asm3r96/yt-transcript-kit)](https://github.com/Asm3r96/yt-transcript-kit/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr/Asm3r96/yt-transcript-kit)](https://github.com/Asm3r96/yt-transcript-kit/pulls)
[![Types](https://img.shields.io/npm/types/yt-transcript-kit)](https://www.npmjs.com/package/yt-transcript-kit)

Lightweight YouTube transcript extraction for apps that want transcript text first, then decide what to do with it. Built with TypeScript and zero runtime dependencies.

## Install

```bash
node --version # requires Node.js 18+
npm install yt-transcript-kit
```

Use `npx yt-transcript-kit --help` for the CLI without installing globally.

## Quick Start

```ts
import { fetchYouTubeTranscript } from 'yt-transcript-kit';

const result = await fetchYouTubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
console.log(result.title, result.fullText);
```

## New APIs

### Transcript Search

```ts
import { fetchYouTubeTranscript, searchTranscript } from 'yt-transcript-kit';

const transcript = await fetchYouTubeTranscript('videoId');
const matches = searchTranscript(transcript, 'keyword', {
  caseSensitive: false,
  maxResults: 20,
  contextChars: 24,
});

console.log(matches[0]);
```

### Chunking for LLM pipelines

```ts
import { fetchYouTubeTranscript, chunkTranscript } from 'yt-transcript-kit';

const transcript = await fetchYouTubeTranscript('videoId');

const chunks = chunkTranscript(transcript, {
  maxChars: 4000,
  maxTokens: 1200,
  overlapSegments: 1,
  mergeAdjacentShortSegments: true,
});

console.log(chunks[0]);
```

### Formatting modes

```ts
import { fetchYouTubeTranscript, formatTranscript } from 'yt-transcript-kit';

const transcript = await fetchYouTubeTranscript('videoId');

const plainText = formatTranscript(transcript, { mode: 'plainText' });
const markdown = formatTranscript(transcript, { mode: 'markdown', includeTimestamps: true });
const paragraphs = formatTranscript(transcript, { mode: 'paragraphs', paragraphMergeThresholdSec: 2 });
const segments = formatTranscript(transcript, { mode: 'segments' });

console.log(markdown);
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

console.log(transcript.videoId);
```

### Batch fetching

```ts
import { fetchManyYouTubeTranscripts } from 'yt-transcript-kit';

const results = await fetchManyYouTubeTranscripts(['videoId1', 'videoId2'], { concurrency: 3 });

for (const item of results) {
  if (item.success) {
    console.log(item.result.videoId, item.result.languageCode);
  } else {
    console.error(item.input, item.error.code);
  }
}
```

### Cleanup helpers

```ts
import {
  cleanTranscriptSegments,
  cleanTranscriptText,
  fetchYouTubeTranscript,
} from 'yt-transcript-kit';

const transcript = await fetchYouTubeTranscript('videoId');

const cleanedText = cleanTranscriptText(transcript, {
  stripBracketedMarkers: true,
  dedupeAdjacentLines: true,
});

const cleanedSegments = cleanTranscriptSegments(transcript.segments, {
  normalizeWhitespace: true,
});

console.log(cleanedText, cleanedSegments.length);
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
npx yt-transcript-kit batch urls.txt --format json
npx yt-transcript-kit batch urls.txt --concurrency 3
```

Use `--help` to print command help.

Typical CLI uses:

- `--search` prints matching transcript segments with their segment index.
- `--chunks` prints chunked transcript text, or structured JSON when combined with `--format json`.
- `batch <file> --format json` returns per-input success or failure records.

## Error Codes

`INVALID_VIDEO_ID`, `VIDEO_UNAVAILABLE`, `RATE_LIMITED`, `NO_TRANSCRIPT`, `LANGUAGE_NOT_AVAILABLE`, `REQUEST_FAILED`.

## Environment Notes

- Node.js `18+` is required.
- Standard browsers are not supported because YouTube transcript requests are blocked by CORS.
- Server runtimes, CLIs, browser extensions, and React Native are the intended environments.

## Development

```bash
npm run build
npm run typecheck
npm run test
```
