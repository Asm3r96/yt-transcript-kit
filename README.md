# yt-transcript-kit

Lightweight YouTube transcript extraction for apps that want transcript text first, then decide what to do with it.

## What it does

- Accepts a YouTube URL or video ID
- Resolves caption tracks
- Fetches transcript text and timestamped segments
- Returns plain data with typed errors

## What it does not do

- It does not summarize the page
- It does not answer questions for you
- It does not bundle audio transcription fallback yet

## Install

```bash
npm install yt-transcript-kit
```

## Works well in

- Node.js CLIs
- React Native apps
- browser extensions

## Less reliable in

- regular browser websites without a backend proxy

Direct YouTube requests in normal websites can run into browser CORS restrictions.

## Usage

```ts
import { fetchYouTubeTranscript } from 'yt-transcript-kit';

const transcript = await fetchYouTubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

console.log(transcript.title);
console.log(transcript.fullText);
console.log(transcript.segments[0]);
```

## Returned shape

```ts
type YouTubeTranscriptResult = {
  videoId: string;
  title: string | null;
  languageCode: string;
  languageLabel: string | null;
  isGenerated: boolean;
  source: 'youtube_caption_track';
  fullText: string;
  segments: Array<{
    text: string;
    offset: number;
    duration: number;
  }>;
}
```

## Error handling

```ts
import {
  fetchYouTubeTranscript,
  YouTubeTranscriptError,
} from 'yt-transcript-kit';

try {
  const result = await fetchYouTubeTranscript('dQw4w9WgXcQ');
  console.log(result.fullText);
} catch (error) {
  if (error instanceof YouTubeTranscriptError) {
    console.error(error.code, error.message);
  }
}
```

## Local smoke test

```bash
npm install
npm run smoke
npx tsx scripts/smoke.ts "https://www.youtube.com/watch?v=LqN_ItMqovA"
```
