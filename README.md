# yt-transcript-kit

[![NPM Version](https://img.shields.io/npm/v/yt-transcript-kit.svg)](https://www.npmjs.com/package/yt-transcript-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Issues](https://img.shields.io/github/issues/Asm3r96/yt-transcript-kit)](https://github.com/Asm3r96/yt-transcript-kit/issues)
[![Pull Requests](https://img.shields.io/github/issues-pr/Asm3r96/yt-transcript-kit)](https://github.com/Asm3r96/yt-transcript-kit/pulls)
[![Types](https://img.shields.io/npm/types/yt-transcript-kit)](https://www.npmjs.com/package/yt-transcript-kit)

Lightweight YouTube transcript extraction for apps that want transcript text first, then decide what to do with it. Built with TypeScript and zero runtime dependencies.

## Key Features

- **Robust Extraction**: Uses a hybrid approach (HTML + InnerTube API) for better reliability.
- **Lightweight**: Zero runtime dependencies, tiny bundle size.
- **Typed Errors**: Programmatic error handling with specific codes.
- **Flexible**: Works in Node.js, React Native, and Browser Extensions.
- **Multi-language**: Support for requesting specific languages with fallbacks.

## Install

```bash
npm install yt-transcript-kit
```

## Quick Start

```ts
import { fetchYouTubeTranscript } from 'yt-transcript-kit';

try {
  const result = await fetchYouTubeTranscript('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  
  console.log(`Title: ${result.title}`);
  console.log(`Full Text: ${result.fullText.substring(0, 100)}...`);
  
  // Useful metadata
  console.log(`Language: ${result.languageLabel} (${result.languageCode})`);
  console.log(`Auto-generated: ${result.isGenerated}`);
} catch (error) {
  // Handle typed errors (Rate limited, Video unavailable, etc.)
}
```

## Using It In A Phone App

For a React Native app, install the package and call it directly when the user pastes a YouTube URL.

```bash
npm install yt-transcript-kit
```

```ts
import { fetchYouTubeTranscript } from 'yt-transcript-kit';

async function handleYouTubeUrl(url: string) {
  const transcript = await fetchYouTubeTranscript(url);

  return {
    title: transcript.title,
    text: transcript.fullText,
    languageCode: transcript.languageCode,
    isGenerated: transcript.isGenerated,
  };
}
```

Typical app flow:

1. User pastes a YouTube URL.
2. Your app calls `fetchYouTubeTranscript(url)`.
3. Your app gets the full transcript text.
4. Your app sends that text to your AI prompt for summarizing or question answering.

Example AI prompt shape:

```ts
const transcript = await fetchYouTubeTranscript(url);

const prompt = [
  'You are a helpful assistant.',
  'Use only the provided YouTube transcript.',
  `User request:\n${userPrompt || 'Summarize this video.'}`,
  `Video title:\n${transcript.title ?? 'Unknown title'}`,
  `Transcript:\n${transcript.fullText}`,
].join('\n\n');
```

## Advanced Usage

### Requesting Specific Languages

You can specify preferred languages. The library will try to find the best match in order.

```ts
const transcript = await fetchYouTubeTranscript('videoId', {
  languages: ['fr', 'de', 'en'], // Prefer French, then German, then English
});
```

### Custom Fetch & AbortSignal

Perfect for environments with unique fetch requirements or for adding timeouts.

```ts
const controller = new AbortController();

const transcript = await fetchYouTubeTranscript('videoId', {
  signal: controller.signal,
  fetchImpl: customFetchWrapper, // e.g. with proxy support
});
```

## Documentation

- [**Contributing Guide**](./docs/CONTRIBUTING.md): Learn how to set up the project and submit PRs.
- [**Architecture**](./docs/ARCHITECTURE.md): Deep dive into how the library extracts data from YouTube.
- [**Security Policy**](./docs/SECURITY.md): How to report security vulnerabilities.
- [**Changelog**](./docs/CHANGELOG.md): Track project history and updates.

## Support Matrix

| Environment | Status | Notes |
| :--- | :--- | :--- |
| **Node.js** | ✅ Supported | Requires Node 18+ for native fetch. |
| **React Native** | ✅ Supported | Works great with the native fetch polyfill. |
| **CLIs** | ✅ Supported | Excellent for building tools. |
| **Web Browser** | ⚠️ Limited | Direct requests usually fail due to YouTube's CORS policy. Use a backend proxy. |
| **Extensions** | ✅ Supported | Chrome extensions can bypass CORS with appropriate permissions. |

## Error Codes

When a request fails, the library throws a `YouTubeTranscriptError` with one of the following codes:

- `INVALID_VIDEO_ID`: The provided URL or ID is not valid.
- `VIDEO_UNAVAILABLE`: Video is private, deleted, or region-restricted.
- `RATE_LIMITED`: YouTube has blocked your IP. Take a break or use a proxy.
- `NO_TRANSCRIPT`: The video does not have any captions available.
- `LANGUAGE_NOT_AVAILABLE`: Specific language requested was not found.
- `REQUEST_FAILED`: General network or parsing error.

## Development

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run quality checks
npm run typecheck

# Run smoke test with a real URL
npm run smoke -- "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
```

## License

MIT © [Asm3r96](https://github.com/Asm3r96)
