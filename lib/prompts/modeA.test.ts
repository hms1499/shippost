import { describe, it, expect } from 'vitest';
import { buildModeAPrompt } from './modeA';

describe('buildModeAPrompt — hook', () => {
  it('invites a hook on tweet 1 and no longer bans question openers', () => {
    const out = buildModeAPrompt({ topic: 'reentrancy guards', audience: 'intermediate', searchSummary: null });
    expect(out).toMatch(/hook/i);
    expect(out).not.toMatch(/No question opener/i);
  });
});

describe('buildModeAPrompt — fabrication guard', () => {
  // The bug this pins: the specifics rule used to ride along inside
  // REFERENCE_GUIDANCE, which is only pushed when search returned something.
  // With no searchSummary the prompt carried NO rule against inventing an
  // address or a function signature — the thin-grounding case, where the model
  // has the most room to invent and had the fewest rules stopping it.
  it('carries the specifics rule even when no references were retrieved', () => {
    const out = buildModeAPrompt({ topic: 'EIP-4844 blob fee market', audience: 'advanced', searchSummary: null });
    expect(out).toMatch(/IDENTIFIERS AND VOLATILE NUMBERS/);
    expect(out).toMatch(/function signatures/i);
  });

  it('carries it with references too, pointing at them as the source', () => {
    const out = buildModeAPrompt({
      topic: 'EIP-4844 blob fee market',
      audience: 'advanced',
      searchSummary: '- Dencun activated on March 13, 2024.',
    });
    expect(out).toMatch(/IDENTIFIERS AND VOLATILE NUMBERS/);
    expect(out).toMatch(/appear in the reference facts below/);
  });

  // Absence, not just contradiction, has to disqualify a specific. The sampled
  // "commitBlob(bytes) at 0x4200...0010" conflicted with nothing, because the
  // references said nothing about it — so a conflict-only rule never fired.
  it('treats an absent specific as disqualifying, not merely uncontradicted', () => {
    const out = buildModeAPrompt({ topic: 'ERC-4337 bundler economics', audience: 'advanced', searchSummary: null });
    expect(out).toMatch(/Not being contradicted is NOT permission/);
  });

  // Protocol semantics must stay licensed, or the fix trades fabrication for
  // the blandness that made mode 1-5 unreadable. The EIP-712 few-shot in this
  // same prompt is built entirely from such semantics.
  it('still licenses protocol semantics from the model\'s own understanding', () => {
    const out = buildModeAPrompt({ topic: 'reentrancy guards', audience: 'advanced', searchSummary: null });
    expect(out).toMatch(/PROTOCOL SEMANTICS/);
    expect(out).toMatch(/from your own understanding/);
  });

  it('does not let thin references license a specific they do not contain', () => {
    const out = buildModeAPrompt({
      topic: 'reentrancy guards',
      audience: 'advanced',
      searchSummary: '- Some marketing page about smart contract security.',
    });
    expect(out).toMatch(/cannot license a specific they do not contain/);
    expect(out).not.toMatch(/ignore them and write from your own knowledge/);
  });
});
