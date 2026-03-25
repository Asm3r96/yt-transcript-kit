import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  InMemoryTranscriptCache,
  chunkTranscript,
  cleanTranscriptSegments,
  formatTranscript,
  fetchManyYouTubeTranscripts,
  fetchYouTubeTranscript,
  searchTranscript,
  type YouTubeTranscriptResult,
} from '../src/index.js';

const baseSegments = [
  { text: 'Hello world', offset: 0, duration: 1 },
  { text: 'This is a tiny test', offset: 1.2, duration: 1 },
  { text: 'hello again', offset: 2.5, duration: 1 },
];

test('searchTranscript supports case-insensitive and maxResults', () => {
  const matches = searchTranscript(baseSegments, 'hello', { maxResults: 1 });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].segmentIndex, 0);
});

test('chunkTranscript supports max chars and overlap', () => {
  const chunks = chunkTranscript(baseSegments, { maxChars: 15, overlapSegments: 1 });
  assert.ok(chunks.length >= 2);
  assert.ok(chunks[0].segmentIndexes.length >= 1);
  assert.ok(chunks.every(chunk => chunk.text.length > 0));
});

test('formatTranscript supports markdown and paragraphs', () => {
  const markdown = formatTranscript(baseSegments, { mode: 'markdown', includeTimestamps: true });
  assert.equal(typeof markdown, 'string');
  assert.match(markdown as string, /\[00:00\]/);

  const paragraphs = formatTranscript(baseSegments, { mode: 'paragraphs' });
  assert.ok(Array.isArray(paragraphs));
  assert.equal(paragraphs.length, 1);
});

test('cleanTranscriptSegments strips markers and dedupes adjacent lines', () => {
  const cleaned = cleanTranscriptSegments(
    [
      { text: '[Music] hello', offset: 0, duration: 1 },
      { text: 'hello', offset: 1, duration: 1 },
    ],
    { stripBracketedMarkers: true, dedupeAdjacentLines: true },
  );
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0].text, 'hello');
});

test('cache works with fetchYouTubeTranscript', async () => {
  let calls = 0;
  const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
    calls += 1;
    const url = String(input);
    if (url.includes('/watch')) {
      return new Response(`
      <html>
      <title>Video - YouTube</title>
      <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://example.com/caption","languageCode":"en","name":{"simpleText":"English"}}]}},"videoDetails":{"title":"Video","author":"Channel","lengthSeconds":"12"}};</script>
      </html>`, { status: 200 });
    }
    return new Response('<transcript><text start="0" dur="1">Hello</text></transcript>', { status: 200 });
  };

  const cache = new InMemoryTranscriptCache<YouTubeTranscriptResult>();
  const first = await fetchYouTubeTranscript('dQw4w9WgXcQ', { fetchImpl: mockFetch, cache });
  const second = await fetchYouTubeTranscript('dQw4w9WgXcQ', { fetchImpl: mockFetch, cache });
  assert.equal(first.fullText, second.fullText);
  assert.equal(calls, 2);
});

test('fetchManyYouTubeTranscripts preserves input order and per-item failures', async () => {
  const mockFetch: typeof fetch = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('badbadbad11')) {
      return new Response('oops', { status: 404 });
    }
    if (url.includes('/watch')) {
      return new Response(`
      <html>
      <script>var ytInitialPlayerResponse = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://example.com/caption","languageCode":"en"}]}},"videoDetails":{"title":"Video"}};</script>
      </html>`, { status: 200 });
    }
    return new Response('<transcript><text start="0" dur="1">Hello</text></transcript>', { status: 200 });
  };

  const result = await fetchManyYouTubeTranscripts(['dQw4w9WgXcQ', 'badbadbad11'], { fetchImpl: mockFetch, concurrency: 2 });
  assert.equal(result.length, 2);
  assert.equal(result[0].input, 'dQw4w9WgXcQ');
  assert.equal(result[1].input, 'badbadbad11');
  assert.equal(result[0].success, true);
  assert.equal(result[1].success, false);
});

test('CLI smoke test prints help', () => {
  const output = execFileSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', '--help'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.match(output, /Usage:/);
});
