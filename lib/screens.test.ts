import { describe, it, expect } from 'vitest';
import { isInputScreen, isOutputScreen, type Screen } from './screens';

const ALL = [
  'mode',
  'educational',
  'hot-take',
  'news-breakdown',
  'token-analysis',
  'daily-recap',
  'comparison',
  'preview-locked',
  'generating',
  'preview',
  'post-share',
] satisfies Screen[];

describe('isInputScreen', () => {
  it('is true only for the input screens', () => {
    expect(ALL.filter(isInputScreen)).toEqual([
      'mode',
      'educational',
      'hot-take',
      'news-breakdown',
      'token-analysis',
      'daily-recap',
      'comparison',
    ]);
  });
});

describe('isOutputScreen', () => {
  it('is the exact complement of isInputScreen', () => {
    expect(ALL.filter(isOutputScreen)).toEqual([
      'preview-locked',
      'generating',
      'preview',
      'post-share',
    ]);
  });

  it('every screen is exactly one of input or output', () => {
    for (const s of ALL) {
      expect(isInputScreen(s)).toBe(!isOutputScreen(s));
    }
  });
});

describe('news-breakdown screen', () => {
  it('news-breakdown is an input screen', () => {
    expect(isInputScreen('news-breakdown')).toBe(true);
    expect(isOutputScreen('news-breakdown')).toBe(false);
  });
});
