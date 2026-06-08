import { describe, it, expect } from 'vitest';
import { moveTweet, deleteTweet } from './threadEdits';

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
