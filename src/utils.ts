export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

export function extractBalancedJson(source: string, startIndex: number): string | null {
  let braceCount = 0;
  let inString = false;
  let escape = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      braceCount += 1;
    } else if (char === '}') {
      braceCount -= 1;
      if (braceCount === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

export function looksRateLimited(html: string): boolean {
  return (
    html.includes('g-recaptcha') ||
    html.includes('Our systems have detected unusual traffic')
  );
}
