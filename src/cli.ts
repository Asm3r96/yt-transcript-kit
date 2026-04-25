#!/usr/bin/env node
import {
  chunkTranscript,
  fetchManyYouTubeTranscripts,
  fetchYouTubeTranscript,
  formatTranscript,
  searchTranscript,
  searchYouTube,
  searchYouTubeWithTranscripts,
} from './index.js';

interface CliOptions {
  format: 'txt' | 'json' | 'markdown';
  languages?: string[];
  search?: string;
  chunks?: boolean;
  maxChars?: number;
  concurrency?: number;
  maxResults?: number;
  transcripts?: boolean;
}

function printHelp(): void {
  console.log(`yt-transcript-kit

Usage:
  yt-transcript-kit <url-or-video-id> [options]
  yt-transcript-kit batch <file> [options]
  yt-transcript-kit search <query> [options]

Options:
  --format <txt|json|markdown>   Output format (default: txt)
  --languages <de,en>            Preferred languages
  --search <query>               Search query in transcript
  --chunks                        Output chunks instead of full transcript
  --max-chars <n>                Max chars per chunk
  --concurrency <n>              Batch concurrency (default: 3)
  --max-results <n>              Max search results (default: 20)
  --transcripts                  Also fetch transcripts for search results
  --help                         Show help
`);
}

function parseArgs(args: string[]): { command: 'single' | 'batch' | 'search' | 'help'; input?: string; options: CliOptions } {
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    return { command: 'help', options: { format: 'txt' } };
  }

  const options: CliOptions = { format: 'txt' };
  let positionals: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const value = args[i + 1];
    switch (arg) {
      case '--format':
        if (value === 'txt' || value === 'json' || value === 'markdown') {
          options.format = value;
          i += 1;
        }
        break;
      case '--languages':
        options.languages = value?.split(',').map(v => v.trim()).filter(Boolean);
        i += 1;
        break;
      case '--search':
        options.search = value;
        i += 1;
        break;
      case '--chunks':
        options.chunks = true;
        break;
      case '--max-chars':
        options.maxChars = Number.parseInt(value ?? '0', 10);
        i += 1;
        break;
      case '--concurrency':
        options.concurrency = Number.parseInt(value ?? '3', 10);
        i += 1;
        break;
      case '--max-results':
        options.maxResults = Number.parseInt(value ?? '20', 10);
        i += 1;
        break;
      case '--transcripts':
        options.transcripts = true;
        break;
      default:
        break;
    }
  }

  if (positionals[0] === 'batch') {
    return { command: 'batch', input: positionals[1], options };
  }

  if (positionals[0] === 'search') {
    return { command: 'search', input: positionals.slice(1).join(' '), options };
  }

  return { command: 'single', input: positionals[0], options };
}

function printSearchResults(results: Array<Record<string, unknown>>, format: string): void {
  if (format === 'json') {
    console.log(JSON.stringify(results, null, 2));
    return;
  }

  for (const result of results) {
    const title = result.title as string;
    const url = result.url as string;
    const channel = result.channelName as string;
    const duration = result.duration as string | null;
    const views = result.viewCount as string | null;
    const published = result.publishedAt as string | null;

    const metaParts: string[] = [];
    if (duration) metaParts.push(duration);
    if (views) metaParts.push(views);
    if (published) metaParts.push(published);

    const meta = metaParts.length ? ` (${metaParts.join(' · ')})` : '';
    console.log(`${title}${meta}`);
    console.log(`  ${url}`);
    if (channel) console.log(`  Channel: ${channel}`);
    if (result.description) console.log(`  ${(result.description as string).slice(0, 120)}${(result.description as string).length > 120 ? '...' : ''}`);

    if (result.transcriptError) {
      console.log(`  Transcript: ✖ ${result.transcriptError}`);
    } else if (result.transcript) {
      const t = result.transcript as { fullText?: string };
      const preview = t.fullText ? `${t.fullText.slice(0, 200).replace(/\s+/g, ' ').trim()}...` : '✔ Available';
      console.log(`  Transcript: ${preview}`);
    }
    console.log();
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.command === 'help') {
    printHelp();
    return;
  }

  if (!parsed.input) {
    console.error('Missing input. Run with --help for usage.');
    process.exitCode = 1;
    return;
  }

  if (parsed.command === 'batch') {
    const { readFile } = await import('node:fs/promises');
    const body = await readFile(parsed.input, 'utf8');
    const inputs = body.split(/\r?\n/).map((line: string) => line.trim()).filter(Boolean);
    const batch = await fetchManyYouTubeTranscripts(inputs, {
      languages: parsed.options.languages,
      concurrency: parsed.options.concurrency,
    });
    if (parsed.options.format === 'json') {
      console.log(JSON.stringify(batch, null, 2));
    } else {
      for (const item of batch) {
        if (item.success) {
          console.log(`✔ ${item.input}: ${item.result.title ?? item.result.videoId}`);
        } else {
          console.log(`✖ ${item.input}: ${item.error.code}`);
        }
      }
    }
    return;
  }

  if (parsed.command === 'search') {
    try {
      const maxResults = parsed.options.maxResults ?? 20;
      if (parsed.options.transcripts) {
        const results = await searchYouTubeWithTranscripts({
          query: parsed.input,
          maxResults,
          includeTranscripts: true,
          transcriptOptions: {
            languages: parsed.options.languages,
          },
        });
        printSearchResults(results as unknown as Array<Record<string, unknown>>, parsed.options.format);
      } else {
        const results = await searchYouTube({
          query: parsed.input,
          maxResults,
        });
        printSearchResults(results as unknown as Array<Record<string, unknown>>, parsed.options.format);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    return;
  }

  try {
    const transcript = await fetchYouTubeTranscript(parsed.input, {
      languages: parsed.options.languages,
    });

    if (parsed.options.search) {
      const matches = searchTranscript(transcript, parsed.options.search);
      console.log(parsed.options.format === 'json' ? JSON.stringify(matches, null, 2) : matches.map(m => `[${m.segmentIndex}] ${m.text}`).join('\n'));
      return;
    }

    if (parsed.options.chunks) {
      const chunks = chunkTranscript(transcript, { maxChars: parsed.options.maxChars ?? 4000 });
      console.log(parsed.options.format === 'json' ? JSON.stringify(chunks, null, 2) : chunks.map(chunk => `#${chunk.chunkIndex}\n${chunk.text}`).join('\n\n'));
      return;
    }

    if (parsed.options.format === 'json') {
      console.log(JSON.stringify(transcript, null, 2));
      return;
    }

    if (parsed.options.format === 'markdown') {
      console.log(formatTranscript(transcript, { mode: 'markdown', includeTimestamps: true }));
      return;
    }

    console.log(transcript.fullText);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

main();
