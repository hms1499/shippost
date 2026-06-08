/**
 * Pure array helpers for the thread editor (ThreadPreview). Kept side-effect
 * free and immutable so the component can call them in setState updaters and
 * so they can be unit-tested without React.
 */

/** Swap the tweet at `index` with its neighbour in `dir` (-1 up, +1 down).
 *  Returns a new array; returns the input unchanged if the move is impossible
 *  (out of range, or already at an edge). */
export function moveTweet(tweets: string[], index: number, dir: -1 | 1): string[] {
  const target = index + dir;
  if (index < 0 || index >= tweets.length) return tweets;
  if (target < 0 || target >= tweets.length) return tweets;
  const next = [...tweets];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Remove the tweet at `index`. Returns a new array; returns the input
 *  unchanged for an out-of-range index or when it would empty the thread
 *  (the last remaining tweet is protected). */
export function deleteTweet(tweets: string[], index: number): string[] {
  if (index < 0 || index >= tweets.length) return tweets;
  if (tweets.length <= 1) return tweets;
  return tweets.filter((_, i) => i !== index);
}
