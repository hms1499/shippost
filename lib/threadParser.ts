const NUMBERED_START = /^\s*\d+\s*[\/\.\)]\s*/;

export function parseThread(raw: string): string[] {
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  const anyNumbered = paragraphs.some((p) => NUMBERED_START.test(p));
  if (!anyNumbered) return [paragraphs.join('\n\n')];

  return paragraphs;
}
