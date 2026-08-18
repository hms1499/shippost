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
  'preview-unavailable',
  'spend-unavailable',
  'resuming',
  'generating',
  'preview',
  'post-share',
] satisfies Screen[];

// `satisfies Screen[]` only proves every entry IS a Screen — it does not prove
// every Screen is listed, so a new screen used to slip past these tests
// silently. This fails to compile (never is not assignable from true) the
// moment a Screen is missing from ALL.
type Uncovered = Exclude<Screen, (typeof ALL)[number]>;
const _allScreensCovered: [Uncovered] extends [never] ? true : never = true;
void _allScreensCovered;

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
      'preview-unavailable',
      'spend-unavailable',
      'resuming',
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
