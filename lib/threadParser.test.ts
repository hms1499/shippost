import { describe, it, expect } from 'vitest';
import { parseThread, boundThread, MAX_TWEETS } from './threadParser';

describe('parseThread', () => {
  it('splits numbered tweets separated by blank lines', () => {
    const raw = `1/ first tweet text here.

2/ second tweet text here.

3/ last one.`;
    expect(parseThread(raw)).toEqual([
      '1/ first tweet text here.',
      '2/ second tweet text here.',
      '3/ last one.',
    ]);
  });

  it('handles tweets with internal line breaks (single newline)', () => {
    const raw = `1/ line one
still line one.

2/ second tweet.`;
    expect(parseThread(raw)).toEqual([
      '1/ line one\nstill line one.',
      '2/ second tweet.',
    ]);
  });

  it('tolerates "1." or "1)" numbering', () => {
    const raw = `1. first

2) second

3/ third`;
    expect(parseThread(raw)).toEqual([
      '1. first',
      '2) second',
      '3/ third',
    ]);
  });

  it('drops leading/trailing whitespace and empty paragraphs', () => {
    const raw = `\n\n1/ first\n\n\n2/ second\n\n`;
    expect(parseThread(raw)).toEqual(['1/ first', '2/ second']);
  });

  it('returns single element if LLM forgot to number', () => {
    const raw = `Some unnumbered text from the model.`;
    expect(parseThread(raw)).toEqual(['Some unnumbered text from the model.']);
  });

  it('drops an unnumbered preamble so tweet 1 is the hook, not "Here is the thread:"', () => {
    const raw = `Here is the thread:

1/ The real hook.

2/ Body.`;
    expect(parseThread(raw)).toEqual(['1/ The real hook.', '2/ Body.']);
  });

  it('merges a number-only line with the following body (common Groq layout)', () => {
    const raw = `1/

This is the actual hook tweet.

2/

Second tweet body.`;
    expect(parseThread(raw)).toEqual([
      '1/\nThis is the actual hook tweet.',
      '2/\nSecond tweet body.',
    ]);
  });

  it('does not treat a lone "1/" as the preview tweet when a body follows', () => {
    const tweets = parseThread(`1/

The hook that should be free to preview.

2/

Locked follow-up.`);
    expect(tweets[0]).toMatch(/hook that should be free/i);
    expect(tweets[0]).not.toBe('1/');
  });
});

describe('boundThread', () => {
  it('trims and drops empty entries', () => {
    expect(boundThread(['  a  ', '', '   ', 'b'])).toEqual(['a', 'b']);
  });

  it('throws when nothing usable remains', () => {
    expect(() => boundThread(['', '   '])).toThrow(/no usable thread content/);
    expect(() => boundThread([])).toThrow(/no usable thread content/);
  });

  it('caps runaway output at MAX_TWEETS', () => {
    const many = Array.from({ length: MAX_TWEETS + 10 }, (_, i) => `t${i}`);
    expect(boundThread(many)).toHaveLength(MAX_TWEETS);
  });
});
