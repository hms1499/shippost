/**
 * Pure array helpers for the thread editor (ThreadPreview). Kept side-effect
 * free and immutable so the component can call them in setState updaters and
 * so they can be unit-tested without React.
 */

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
