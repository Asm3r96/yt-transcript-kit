import { fetchYouTubeTranscript } from '../src/index.js';

const input = process.argv[2] || 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

async function main() {
  const result = await fetchYouTubeTranscript(input);
  const preview = result.fullText.slice(0, 240);

  console.log(
    JSON.stringify(
      {
        videoId: result.videoId,
        title: result.title,
        languageCode: result.languageCode,
        isGenerated: result.isGenerated,
        segmentCount: result.segments.length,
        preview,
      },
      null,
      2,
    ),
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
