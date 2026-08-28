/**
 * Thread shape: numbering and the 280-character postability boundary.
 *
 * Split out of threadEdits.ts because the pipeline needs this half server-side
 * (generateDraft, factCheckStep) while threadEdits.ts stays the editor's array
 * helpers. One copy, not two: if the server splits a tweet using different
 * seam rules than the editor, ThreadPreview offers a "split into two" button
 * for work the server already did, or refuses one it would have accepted.
 *
 * Everything here is pure and immutable — safe inside setState updaters and
 * inside the pipeline alike.
 */
import { TWEET_MAX_CHARS } from './threadParser';

// Same marker set parseThread accepts (threadParser.ts:1) — "1/", "1.", "1)".
const NUMBERED_START = /^\s*\d+\s*[/.)]\s*/;

/** Characters reserved for a marker a half re-acquires on renumber. Assume the
 *  widest one a bounded thread can produce ("25/ ", MAX_TWEETS = 25) so a split
 *  can't be pushed back over the limit by its own renumbering. */
const MARKER_BUDGET = 4;

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

// A sentence end: terminator, optional closing quote/bracket, whitespace, then
// something that starts a sentence. Both halves of that lookaround matter in
// this domain — requiring the whitespace keeps "$3.94B" and "keccak256(...)"
// intact, and requiring an uppercase letter or digit after it keeps "e.g. foo"
// and "vs. bar" intact. Neither is airtight, but a missed seam only means we
// refuse to split; a false seam would cut mid-sentence, so the bias is right.
const SENTENCE_END = /[.!?]["')’]?\s+(?=["'(“]?[A-Z0-9])/g;

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

/** Offset of the latest seam whose FIRST half fits, with no constraint on the
 *  second. For the repeated cut only: the tail goes back in the queue and is
 *  cut again, so holding it to the budget here would refuse to start on a tweet
 *  long enough to need three tweets — the case fitThread exists for. */
function firstFitSeam(body: string, budget: number): number | null {
  let best: number | null = null;
  for (const m of body.matchAll(SENTENCE_END)) {
    const cut = m.index + m[0].length;
    const a = body.slice(0, cut).trim();
    const b = body.slice(cut).trim();
    if (!a || !b) continue;
    if (a.length <= budget) best = cut;
  }
  return best;
}

/** Cut one tweet into two at a sentence seam, or null when none serves.
 *  Both halves keep the ORIGINAL marker so a later renumber still recognises
 *  the thread as numbered; renumber then rewrites them to their new positions.
 *
 *  `whole: true` demands both halves fit — the editor's single tap, where two
 *  postable tweets is the whole point of the gesture. `whole: false` only
 *  demands the first half fit, for a caller that will keep cutting.
 *
 *  The single place a seam becomes a cut — canSplit, splitTweet and fitThread
 *  all route through it, so they cannot drift apart. */
function splitOnce(tweet: string, budget: number, whole: boolean): [string, string] | null {
  const prefix = tweet.match(NUMBERED_START)?.[0] ?? '';
  const body = tweet.slice(prefix.length);
  const cut = whole ? bestSeam(body, budget) : firstFitSeam(body, budget);
  if (cut === null) return null;
  return [prefix + body.slice(0, cut).trim(), prefix + body.slice(cut).trim()];
}

/** Would splitTweet actually do something for this tweet? Drives the UI
 *  affordance, so it must agree exactly with splitTweet's own decision. */
export function canSplit(tweet: string, limit = TWEET_MAX_CHARS): boolean {
  if (tweet.length <= limit) return false;
  return splitOnce(tweet, limit - MARKER_BUDGET, true) !== null;
}

/** Split the over-long tweet at `index` into two at a sentence boundary, then
 *  renumber. Content is never cut: if no seam leaves both halves inside the
 *  limit the thread comes back untouched, and the UI keeps warning instead.
 *
 *  One cut only — this is the editor's per-tap operation, and a tap should do
 *  one visible thing. fitThread is the repeated form. */
export function splitTweet(tweets: string[], index: number, limit = TWEET_MAX_CHARS): string[] {
  if (index < 0 || index >= tweets.length) return tweets;
  const halves = splitOnce(tweets[index], limit - MARKER_BUDGET, true);
  if (tweets[index].length <= limit || halves === null) return tweets;

  const next = [...tweets];
  next.splice(index, 1, halves[0], halves[1]);
  return renumber(next);
}

/** One left-to-right pass: every over-long tweet that has a seam becomes two.
 *  `changed` reports whether anything moved, so fitThread knows to look again. */
function fitPass(tweets: string[], limit: number): { tweets: string[]; changed: boolean } {
  const out: string[] = [];
  let changed = false;
  for (const tweet of tweets) {
    // A 700-char tweet needs more than one cut, and each half may need another.
    // Queue rather than recurse so the traversal order stays the reading order.
    const queue = [tweet];
    while (queue.length > 0) {
      const t = queue.shift() as string;
      if (t.length <= limit) {
        out.push(t);
        continue;
      }
      // Prefer the cut that leaves two postable tweets — same seam the editor
      // would pick, so the two never disagree on a tweet either could fix. Only
      // when no such seam exists do we start a run of cuts.
      const budget = limit - MARKER_BUDGET;
      const halves = splitOnce(t, budget, true) ?? splitOnce(t, budget, false);
      if (halves === null) {
        // No seam: hand it over intact. Cutting the fact out to fit is the one
        // thing this module must never do (threadParser.ts:45).
        out.push(t);
        continue;
      }
      // Both halves are strictly shorter than what they replaced (bestSeam
      // rejects an empty side), so this terminates.
      queue.unshift(halves[0], halves[1]);
      changed = true;
    }
  }
  return { tweets: out, changed };
}

/** Bring every tweet inside the postability limit by splitting at sentence
 *  boundaries, and report the ones that could not be brought inside it.
 *
 *  Nothing is ever truncated or rewritten — a tweet with no usable seam comes
 *  back verbatim and its index is returned in `unfixable`, which is the signal
 *  that the fix has to be a human edit.
 *
 *  Runs to a fixed point (bounded) rather than a single pass, because renumber
 *  can itself lengthen a marker: a thread crossing nine tweets rewrites "9/" as
 *  "10/", which can push a tweet that was exactly at the limit one over. Rare
 *  today at ~7 tweets a thread, but silently shipping an over-long tweet is the
 *  exact failure this function exists to prevent.
 *
 *  `unfixable` indexes the RETURNED array, not the input — it is meant for the
 *  delivered thread. */
export function fitThread(
  tweets: string[],
  limit = TWEET_MAX_CHARS,
): { tweets: string[]; unfixable: number[] } {
  let current = tweets;
  // Two rounds settle any renumber-induced overflow; the third is a guard, not
  // an expectation.
  for (let pass = 0; pass < 3; pass++) {
    const result = fitPass(current, limit);
    current = renumber(result.tweets);
    if (!result.changed) break;
  }
  const unfixable: number[] = [];
  current.forEach((t, i) => {
    if (t.length > limit) unfixable.push(i);
  });
  return { tweets: current, unfixable };
}
