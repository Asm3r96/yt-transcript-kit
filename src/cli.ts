#!/usr/bin/env node
import {
  chunkTranscript,
  fetchManyYouTubeTranscripts,
  fetchYouTubeTranscript,
  formatTranscript,
  searchTranscript,
} from './index.js';

interface CliOptions {
  format: 'txt' | 'json' | 'markdown';
  languages?: string[];
  search?: string;
  chunks?: boolean;
  maxChars?: number;
  concurrency?: number;
}

function printHelp(): void {
  console.log(`yt-transcript-kit\n\nUsage:\n  yt-transcript-kit <url-or-video-id> [options]\n  yt-transcript-kit batch <file> [options]\n\nOptions:\n  --format <txt|json|markdown>   Output format (default: txt)\n  --languages <de,en>            Preferred languages\n  --search <query>               Search query in transcript\n  --chunks                        Output chunks instead of full transcript\n  --max-chars <n>                Max chars per chunk\n  --concurrency <n>              Batch concurrency (default: 3)\n  --help                         Show help\n`);
}

function parseArgs(args: string[]): { command: 'single' | 'batch' | 'help'; input?: string; options: CliOptions } {
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
      default:
        break;
    }
  }

  if (positionals[0] === 'batch') {
    return { command: 'batch', input: positionals[1], options };
  }

  return { command: 'single', input: positionals[0], options };
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
    const inputs = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
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
