import { describe, it, expect } from 'vitest';
import { detectBannedPhrases, phraseList, BANNED_PHRASES } from './bannedPhrases';

describe('detectBannedPhrases', () => {
  it('flags a single banned word with an exclusive end span', () => {
    const m = detectBannedPhrases('we delve here');
    expect(m).toEqual([{ start: 3, end: 8, phrase: 'delve', group: 'slop-opener' }]);
  });

  it('is case-insensitive', () => {
    expect(detectBannedPhrases('DELVE').length).toBe(1);
  });

  it('respects word boundaries (no substring matches)', () => {
    expect(detectBannedPhrases('the delver arrived')).toEqual([]);
    expect(detectBannedPhrases('programming is fun')).toEqual([]); // must not match "GM"
  });

  it('matches multi-word phrases', () => {
    const m = detectBannedPhrases('unlock the power of X');
    expect(m).toEqual([
      { start: 0, end: 16, phrase: 'unlock the power', group: 'marketing' },
    ]);
  });

  it('returns multiple matches sorted by start', () => {
    const m = detectBannedPhrases('a massive, powerful thing');
    expect(m.map((x) => x.phrase)).toEqual(['massive', 'powerful']);
    expect(m.map((x) => x.group)).toEqual(['hype-adjective', 'hype-adjective']);
  });

  it('returns [] for clean crypto/dev text', () => {
    expect(detectBannedPhrases('gas dropped from 40 to 12 gwei')).toEqual([]);
  });
});

describe('phraseList', () => {
  it('quotes and comma-joins a group', () => {
    expect(phraseList('cta-filler')).toBe('"DYOR", "WAGMI", "GM", "ngmi", "anon"');
  });

  it('covers every banned phrase from the original prompt', () => {
    const all = BANNED_PHRASES.flatMap((e) => e.phrases);
    for (const p of ['delve', 'leverage', 'massive', 'game changer', 'DYOR']) {
      expect(all).toContain(p);
    }
  });
});
