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

// Hard ceiling on tweets in one thread. A well-formed X thread is well under
// this; anything past it is the model rambling or returning junk.
export const MAX_TWEETS = 25;

// Validate + bound parsed output before it's settled/persisted. Empty or
// junk model output becomes a clean failure (refundable) instead of a
// persisted empty thread; runaway output is capped.
export function boundThread(tweets: string[]): string[] {
  const cleaned = tweets.map((t) => t.trim()).filter((t) => t.length > 0);
  if (cleaned.length === 0) {
    throw new Error('model returned no usable thread content');
  }
  return cleaned.slice(0, MAX_TWEETS);
}
