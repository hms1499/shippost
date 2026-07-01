import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from './system';
import { BANNED_PHRASES } from '@/lib/bannedPhrases';

describe('SYSTEM_PROMPT', () => {
  it('adds a HOOK block that permits a strong tweet-1 opener', () => {
    expect(SYSTEM_PROMPT).toMatch(/HOOK/);
    expect(SYSTEM_PROMPT).toMatch(/tweet 1/i);
    expect(SYSTEM_PROMPT).toMatch(/carry a fact/i);
  });

  it('drops the 270-character cap', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/270/);
  });

  it('still bans the slop phrases (sourced from bannedPhrases)', () => {
    expect(SYSTEM_PROMPT).toContain('"delve"');
    expect(SYSTEM_PROMPT).toContain('"massive"');
    expect(SYSTEM_PROMPT).toContain('"DYOR"');
  });

  // Locks the prompt to the single-source ban list: if a phrase is ever added
  // to bannedPhrases or a group is renamed so phraseList() drops it, the prompt
  // and the editor highlighter would silently diverge. This fails loudly first.
  it('renders every phrase in BANNED_PHRASES', () => {
    for (const { phrases } of BANNED_PHRASES) {
      for (const phrase of phrases) {
        expect(SYSTEM_PROMPT).toContain(`"${phrase}"`);
      }
    }
  });

  it('keeps the em-dash and no-preamble rules', () => {
    expect(SYSTEM_PROMPT).toMatch(/Em-dash/);
    expect(SYSTEM_PROMPT).toMatch(/Output only the numbered tweets/);
  });
});
