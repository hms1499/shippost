const NUMBERED_START = /^\s*\d+\s*[\/\.\)]\s*/;
const NUMBER_ONLY = /^\s*\d+\s*[\/\.\)]\s*$/;

export function parseThread(raw: string): string[] {
  const paragraphs = raw
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return [];

  const anyNumbered = paragraphs.some((p) => NUMBERED_START.test(p));
  if (!anyNumbered) return [paragraphs.join('\n\n')];

  // Groq often emits the index on its own line ("1/\n\nhook"). Without a
  // merge, tweets[0] is just "1/" and /api/preview shows an empty first tweet.
  const merged: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const next = paragraphs[i + 1];
    if (NUMBER_ONLY.test(p) && next && !NUMBERED_START.test(next)) {
      merged.push(`${p}\n${next}`);
      i += 1;
      continue;
    }
    merged.push(p);
  }

  // Drop preamble / trailing commentary ("Here is the thread:") so the hook
  // is tweet 1 — that is the only tweet the free preview returns.
  return merged.filter((p) => NUMBERED_START.test(p));
}

// Hard ceiling on tweets in one thread. A well-formed X thread is well under
// this; anything past it is the model rambling or returning junk.
export const MAX_TWEETS = 25;

// Postability boundary for a single tweet. X weighs a tweet rather than counting
// JS characters — any URL counts as 23 (t.co), CJK and emoji as 2, most Latin as
// 1 — so `.length` is an approximation. It is the SAFE approximation: where it
// differs it over-counts, so we warn slightly early instead of letting an
// unpostable tweet through. Generated threads are plain Latin prose with no
// links or emoji (SYSTEM_PROMPT bans both), where the two agree exactly.
//
// Deliberately NOT enforced by boundThread: silently truncating a tweet the user
// has paid for is worse than handing them a long one they can edit. This is the
// number the prompts aim at and the UI reports against.
export const TWEET_MAX_CHARS = 280;

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
