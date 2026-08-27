/**
 * Pure array helpers for the thread editor (ThreadPreview). Kept side-effect
 * free and immutable so the component can call them in setState updaters and
 * so they can be unit-tested without React.
 */
import { TWEET_MAX_CHARS } from './threadParser';

// Same marker set parseThread accepts (threadParser.ts:1) — "1/", "1.", "1)".
const NUMBERED_START = /^\s*\d+\s*[/.)]\s*/;

/** Rewrite the "N/" markers to match position.
 *
 *  The marker is part of the tweet TEXT, not presentation: parseThread keeps it
 *  (threadParser.ts:31) and CopyNib / ShareToX post the string verbatim. So
 *  moving or deleting a tweet without this leaves the user posting a thread
 *  numbered 1, 3, 4, 5.
 *
 *  A thread with no marker on its first tweet is left untouched — parseThread
 *  returns a single unnumbered blob when the model emits no markers
 *  (threadParser.ts:13), and numbering that would be inventing content. */
export function renumber(tweets: string[]): string[] {
  if (tweets.length === 0 || !NUMBERED_START.test(tweets[0])) return tweets;
  return tweets.map((t, i) => `${i + 1}/ ${t.replace(NUMBERED_START, '')}`);
}

/** Swap the tweet at `index` with its neighbour in `dir` (-1 up, +1 down).
 *  Returns a new array; returns the input unchanged if the move is impossible
 *  (out of range, or already at an edge). */
export function moveTweet(tweets: string[], index: number, dir: -1 | 1): string[] {
  const target = index + dir;
  if (index < 0 || index >= tweets.length) return tweets;
  if (target < 0 || target >= tweets.length) return tweets;
  const next = [...tweets];
  [next[index], next[target]] = [next[target], next[index]];
  return renumber(next);
}

/** Remove the tweet at `index`. Returns a new array; returns the input
 *  unchanged for an out-of-range index or when it would empty the thread
 *  (the last remaining tweet is protected). */
export function deleteTweet(tweets: string[], index: number): string[] {
  if (index < 0 || index >= tweets.length) return tweets;
  if (tweets.length <= 1) return tweets;
  return renumber(tweets.filter((_, i) => i !== index));
}

// A sentence end: terminator, optional closing quote/bracket, whitespace, then
// something that starts a sentence. Both halves of that lookaround matter in
// this domain — requiring the whitespace keeps "$3.94B" and "keccak256(...)"
// intact, and requiring an uppercase letter or digit after it keeps "e.g. foo"
// and "vs. bar" intact. Neither is airtight, but a missed seam only means we
// refuse to split; a false seam would cut mid-sentence, so the bias is right.
const SENTENCE_END = /[.!?]["')\u2019]?\s+(?=["'(\u201c]?[A-Z0-9])/g;

/** Offset of the seam that fills the first half fullest without either half
 *  exceeding the budget, or null when no seam does. */
function bestSeam(body: string, budget: number): number | null {
  let best: number | null = null;
  for (const m of body.matchAll(SENTENCE_END)) {
    const cut = m.index + m[0].length;
    const a = body.slice(0, cut).trim();
    const b = body.slice(cut).trim();
    if (!a || !b) continue;
    // Latest seam that still fits, so the first half is as full as possible and
    // we don't produce two stubs out of one good tweet.
    if (a.length <= budget && b.length <= budget) best = cut;
  }
  return best;
}

/** Would splitTweet actually do something for this tweet? Drives the UI
 *  affordance, so it must agree exactly with splitTweet's own decision. */
export function canSplit(tweet: string, limit = TWEET_MAX_CHARS): boolean {
  if (tweet.length <= limit) return false;
  const prefix = tweet.match(NUMBERED_START)?.[0] ?? '';
  // Each half re-acquires a marker; assume a 2-digit one so a 10+ tweet thread
  // can't be pushed back over by its own renumbering.
  return bestSeam(tweet.slice(prefix.length), limit - 4) !== null;
}

/** Split the over-long tweet at `index` into two at a sentence boundary, then
 *  renumber. Content is never cut: if no seam leaves both halves inside the
 *  limit the thread comes back untouched, and the UI keeps warning instead.
 *
 *  Deliberately user-initiated rather than automatic. Splitting rewrites a
 *  thread somebody paid for, so it happens on a tap they can see and undo, not
 *  silently inside the pipeline. */
export function splitTweet(tweets: string[], index: number, limit = TWEET_MAX_CHARS): string[] {
  if (index < 0 || index >= tweets.length) return tweets;
  const tweet = tweets[index];
  if (tweet.length <= limit) return tweets;

  const prefix = tweet.match(NUMBERED_START)?.[0] ?? '';
  const body = tweet.slice(prefix.length);
  const cut = bestSeam(body, limit - 4);
  if (cut === null) return tweets;

  // Both halves keep the ORIGINAL marker so renumber can recognise the thread
  // as numbered and rewrite them. Inserting bare bodies would strip the marker
  // from tweets[0] when index is 0, and renumber would then read the whole
  // thread as unnumbered and leave it that way. When prefix is '' (unnumbered
  // thread) the halves stay bare and renumber correctly no-ops.
  const next = [...tweets];
  next.splice(index, 1, prefix + body.slice(0, cut).trim(), prefix + body.slice(cut).trim());
  return renumber(next);
}
