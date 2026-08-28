import { describe, it, expect } from 'vitest';
import { fitThread, canSplit, splitTweet, renumber } from './threadShape';
import { TWEET_MAX_CHARS } from './threadParser';

/** Marker-stripped, whitespace-normalised body of a thread. Splitting is only
 *  ever allowed to move the seams, never to change a word — every test that
 *  claims "no content lost" compares this. */
const body = (tweets: string[]) =>
  tweets.map((t) => t.replace(/^\s*\d+\s*[/.)]\s*/, '')).join(' ').replace(/\s+/g, ' ').trim();

// 296 chars: two sentences after a clean seam, so it splits into 182 + 116.
const LONG =
  '3/ Base sequencer revenue hit $2.1M in July, up 40% from June. Almost all of it comes from L1 data costs falling after Dencun, not from more users. Daily transactions are flat at 8M. The margin story is a blob pricing story, and blob prices are set by whoever else is bidding for that same space.';

// 300+ chars with no sentence terminator anywhere — the residual case.
const SEAMLESS = `1/ ${'the sequencer margin depends on blob base fee which depends on how many rollups post in the same block and that number moves with incentive programs rather than with organic demand '.repeat(2)}`;

describe('fitThread', () => {
  it('leaves a compliant thread untouched', () => {
    const input = ['1/ short one', '2/ short two'];
    const out = fitThread(input);
    expect(out.tweets).toEqual(input);
    expect(out.unfixable).toEqual([]);
  });

  it('returns an empty thread unchanged', () => {
    expect(fitThread([])).toEqual({ tweets: [], unfixable: [] });
  });

  it('splits an over-long tweet into two that both fit', () => {
    const { tweets, unfixable } = fitThread(['1/ a', '2/ b', LONG]);
    expect(tweets).toHaveLength(4);
    expect(tweets.every((t) => t.length <= TWEET_MAX_CHARS)).toBe(true);
    expect(unfixable).toEqual([]);
  });

  it('loses no content when it splits', () => {
    const input = ['1/ a', '2/ b', LONG];
    expect(body(fitThread(input).tweets)).toBe(body(input));
  });

  it('renumbers the whole thread after a split', () => {
    const { tweets } = fitThread([LONG.replace(/^3\//, '1/'), '2/ tail']);
    expect(tweets.map((t) => t.slice(0, 3))).toEqual(['1/ ', '2/ ', '3/ ']);
  });

  it('cuts a tweet more than once when one cut is not enough', () => {
    // Three sentences that each fit but no two of which do: no single seam can
    // leave both halves inside 100, so this only works if the tail is re-cut.
    const s = (n: string) => `${n} ${'word '.repeat(10)}ends here. `;
    const huge = `1/ ${s('One')}${s('Two')}${s('Three')}`.trim();
    expect(huge.length).toBeGreaterThan(190);
    const { tweets, unfixable } = fitThread([huge], 100);
    expect(tweets.length).toBeGreaterThan(2);
    expect(tweets.every((t) => t.length <= 100)).toBe(true);
    expect(unfixable).toEqual([]);
    expect(body(tweets)).toBe(body([huge]));
  });

  it('hands back a seamless tweet uncut and reports it as unfixable', () => {
    const { tweets, unfixable } = fitThread(['1/ ok', SEAMLESS]);
    // Renumbering still applies (the marker is position, not content); the
    // words are untouched, which is the property that matters.
    expect(body([tweets[1]])).toBe(body([SEAMLESS]));
    expect(tweets[1].length).toBeGreaterThan(TWEET_MAX_CHARS);
    expect(unfixable).toEqual([1]);
  });

  it('indexes unfixable against the RETURNED array, not the input', () => {
    // The split ahead of it shifts the seamless tweet from index 1 to index 2.
    const { tweets, unfixable } = fitThread([LONG, SEAMLESS]);
    expect(unfixable).toEqual([2]);
    expect(tweets[2]).toContain('sequencer margin');
  });

  it('splits an unnumbered thread without inventing markers', () => {
    const unnumbered = LONG.replace(/^3\/\s*/, '');
    const { tweets } = fitThread([unnumbered]);
    expect(tweets).toHaveLength(2);
    expect(tweets.every((t) => !/^\s*\d+\s*[/.)]/.test(t))).toBe(true);
  });

  it('honours a custom limit', () => {
    const { tweets } = fitThread([LONG], 200);
    expect(tweets.every((t) => t.length <= 200)).toBe(true);
  });

  it('fixes everything canSplit accepts, and more besides', () => {
    // One direction only. canSplit answers "does ONE cut make two postable
    // tweets" (the editor's tap); fitThread keeps cutting, so it also fixes
    // tweets canSplit refuses. A tweet with no sentence end at all defeats both.
    expect(canSplit(LONG)).toBe(true);
    expect(fitThread([LONG]).unfixable).toEqual([]);

    const s = (n: string) => `${n} ${'word '.repeat(10)}ends here. `;
    const needsTwoCuts = `1/ ${s('One')}${s('Two')}${s('Three')}`.trim();
    expect(canSplit(needsTwoCuts, 100)).toBe(false);
    expect(fitThread([needsTwoCuts], 100).unfixable).toEqual([]);

    expect(canSplit(SEAMLESS)).toBe(false);
    expect(fitThread([SEAMLESS]).unfixable).toEqual([0]);
  });

  it('produces the same first cut as the editor s single-tap split', () => {
    // Same seam rule both sides, so the server never leaves the editor showing
    // a "split into two" button for work it already did differently.
    expect(fitThread([LONG]).tweets).toEqual(renumber(splitTweet([LONG], 0)));
  });
});
