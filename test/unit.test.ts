import { test } from 'node:test';
import assert from 'node:assert/strict';
import { 
  extractVideoId, 
  parseTranscriptXml,
  YouTubeTranscriptError 
} from '../src/index.js';

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
