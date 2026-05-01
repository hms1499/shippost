import { describe, it, expect } from 'vitest';
import { parseThread } from './threadParser';

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
});
