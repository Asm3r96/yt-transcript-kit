import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractVideoId,
  parseTranscriptXml,
  YouTubeTranscriptError,
  searchYouTube,
} from '../src/index.js';
import { extractBalancedJson, looksRateLimited } from '../src/utils.js';

test('extractVideoId - handles various URL formats', () => {
  const cases = [
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube.com/watch?v=dQw4w9WgXcQ&feature=shared', 'dQw4w9WgXcQ'],
  ];

  for (const [input, expected] of cases) {
    assert.strictEqual(extractVideoId(input), expected, `Failed for input: ${input}`);
  }
});

test('extractVideoId - throws for invalid IDs', () => {
  assert.throws(() => extractVideoId('invalid'), {
    name: 'YouTubeTranscriptError',
    code: 'INVALID_VIDEO_ID',
  });
});

test('parseTranscriptXml - handles standard timed text format', () => {
  const xml = `
    <?xml version="1.0" encoding="utf-8" ?>
    <transcript>
      <text start="0" dur="1.5">Hello world</text>
      <text start="1.5" dur="2">This is a test</text>
    </transcript>
  `;
  const segments = parseTranscriptXml(xml);
  
  assert.strictEqual(segments.length, 2);
  assert.strictEqual(segments[0].text, 'Hello world');
  assert.strictEqual(segments[0].offset, 0);
  assert.strictEqual(segments[0].duration, 1.5);
  assert.strictEqual(segments[1].text, 'This is a test');
});

test('parseTranscriptXml - handles paragraph format', () => {
  const xml = `
    <root>
      <p t="0" d="1000">Welcome</p>
      <p t="1000" d="2000">To the machine</p>
    </root>
  `;
  const segments = parseTranscriptXml(xml);
  
  assert.strictEqual(segments.length, 2);
  assert.strictEqual(segments[0].text, 'Welcome');
  assert.strictEqual(segments[0].offset, 0); // 0ms / 1000
  assert.strictEqual(segments[1].offset, 1); // 1000ms / 1000
});

test('parseTranscriptXml - decodes HTML entities', () => {
  const xml = `<transcript><text start="0" dur="1">It&apos;s &quot;fine&quot; &amp; good</text></transcript>`;
  const segments = parseTranscriptXml(xml);
  assert.strictEqual(segments[0].text, 'It\'s "fine" & good');
});

test('extractBalancedJson - parses balanced braces correctly', () => {
  const source = 'prefix{"a":1,"b":{"c":2}}suffix';
  const result = extractBalancedJson(source, 6);
  assert.strictEqual(result, '{"a":1,"b":{"c":2}}');
});

test('extractBalancedJson - handles nested objects and strings with braces', () => {
  const source = '{"text":"hello {world}","nested":{"deep":true}}';
  const result = extractBalancedJson(source, 0);
  assert.strictEqual(result, source);
});

test('extractBalancedJson - returns null for unbalanced input', () => {
  const source = '{"a":1';
  const result = extractBalancedJson(source, 0);
  assert.strictEqual(result, null);
});

test('looksRateLimited - detects rate limit indicators', () => {
  assert.strictEqual(looksRateLimited('g-recaptcha'), true);
  assert.strictEqual(looksRateLimited('Our systems have detected unusual traffic'), true);
  assert.strictEqual(looksRateLimited('normal youtube page'), false);
});

test('YouTubeTranscriptError - supports search error codes', () => {
  const emptyQueryError = new YouTubeTranscriptError('EMPTY_QUERY', 'Query cannot be empty.');
  assert.strictEqual(emptyQueryError.code, 'EMPTY_QUERY');
  assert.strictEqual(emptyQueryError.message, 'Query cannot be empty.');
  assert.strictEqual(emptyQueryError.name, 'YouTubeTranscriptError');

  const searchFailedError = new YouTubeTranscriptError('SEARCH_FAILED', 'Could not parse results.');
  assert.strictEqual(searchFailedError.code, 'SEARCH_FAILED');
});

test('searchYouTube - throws EMPTY_QUERY for empty string', async () => {
  await assert.rejects(
    () => searchYouTube({ query: '' }),
    (err: unknown) => err instanceof YouTubeTranscriptError && (err as YouTubeTranscriptError).code === 'EMPTY_QUERY',
  );
});

test('searchYouTube - throws EMPTY_QUERY for whitespace-only query', async () => {
  await assert.rejects(
    () => searchYouTube({ query: '   ' }),
    (err: unknown) => err instanceof YouTubeTranscriptError && (err as YouTubeTranscriptError).code === 'EMPTY_QUERY',
  );
});
