import { describe, it, expect } from 'vitest';
import { moveTweet, deleteTweet, renumber } from './threadEdits';

describe('moveTweet', () => {
  it('swaps an item up (dir -1)', () => {
    expect(moveTweet(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
  });

  it('swaps an item down (dir +1)', () => {
    expect(moveTweet(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
  });

  it('returns input unchanged when moving the first item up', () => {
    const input = ['a', 'b', 'c'];
    expect(moveTweet(input, 0, -1)).toEqual(['a', 'b', 'c']);
  });

  it('returns input unchanged when moving the last item down', () => {
    const input = ['a', 'b', 'c'];
    expect(moveTweet(input, 2, 1)).toEqual(['a', 'b', 'c']);
  });

  it('returns input unchanged for an out-of-range index', () => {
    expect(moveTweet(['a', 'b'], 5, -1)).toEqual(['a', 'b']);
    expect(moveTweet(['a', 'b'], -1, 1)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    moveTweet(input, 1, -1);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

describe('deleteTweet', () => {
  it('removes the item at the given index', () => {
    expect(deleteTweet(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });

  it('protects the last remaining tweet (no empty thread)', () => {
    expect(deleteTweet(['only'], 0)).toEqual(['only']);
  });

  it('returns input unchanged for an out-of-range index', () => {
    expect(deleteTweet(['a', 'b'], 9)).toEqual(['a', 'b']);
    expect(deleteTweet(['a', 'b'], -1)).toEqual(['a', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = ['a', 'b', 'c'];
    deleteTweet(input, 0);
    expect(input).toEqual(['a', 'b', 'c']);
  });
});

// The "N/" marker lives INSIDE the tweet text — parseThread keeps it
// (threadParser.ts:31) and CopyNib/ShareToX post the string verbatim. So any
// structural edit has to rewrite the prefixes or the user posts a thread
// numbered 1, 3, 4, 5.
describe('numbering survives structural edits', () => {
  const thread = ['1/ hook', '2/ second', '3/ third', '4/ close'];

  it('renumbers after a delete', () => {
    expect(deleteTweet(thread, 1)).toEqual(['1/ hook', '2/ third', '3/ close']);
  });

  it('renumbers after a move', () => {
    expect(moveTweet(thread, 1, 1)).toEqual(['1/ hook', '2/ third', '3/ second', '4/ close']);
  });

  it('leaves an unnumbered thread alone', () => {
    // parseThread returns a single unnumbered blob when the model emits no
    // markers (threadParser.ts:13). Inventing numbers there would be a rewrite.
    expect(deleteTweet(['plain a', 'plain b', 'plain c'], 0)).toEqual(['plain b', 'plain c']);
  });

  it('accepts the other markers parseThread accepts', () => {
    expect(renumber(['1) a', '2) b'])).toEqual(['1/ a', '2/ b']);
    expect(renumber(['1. a', '2. b'])).toEqual(['1/ a', '2/ b']);
  });

  it('renumbers a thread whose markers are already wrong', () => {
    expect(renumber(['1/ a', '7/ b', '3/ c'])).toEqual(['1/ a', '2/ b', '3/ c']);
  });

  it('does not mutate its input', () => {
    const input = ['1/ a', '2/ b'];
    renumber(input);
    expect(input).toEqual(['1/ a', '2/ b']);
  });
});
