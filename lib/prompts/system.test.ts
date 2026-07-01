import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from './system';

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

  it('keeps the em-dash and no-preamble rules', () => {
    expect(SYSTEM_PROMPT).toMatch(/Em-dash/);
    expect(SYSTEM_PROMPT).toMatch(/Output only the numbered tweets/);
  });
});
