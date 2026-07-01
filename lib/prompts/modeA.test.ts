import { describe, it, expect } from 'vitest';
import { buildModeAPrompt } from './modeA';

describe('buildModeAPrompt — hook', () => {
  it('invites a hook on tweet 1 and no longer bans question openers', () => {
    const out = buildModeAPrompt({ topic: 'reentrancy guards', audience: 'intermediate', searchSummary: null });
    expect(out).toMatch(/hook/i);
    expect(out).not.toMatch(/No question opener/i);
  });
});
