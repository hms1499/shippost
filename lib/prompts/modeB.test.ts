import { describe, it, expect } from 'vitest';
import { buildModeBPrompt } from './modeB';

const baseInput = {
  eventDescription: 'Vitalik posted a draft EIP for encrypted mempools.',
  searchSummary: '- Draft EIP discusses commit-reveal mempool scheme.',
  marketSnippet: 'ETH @ $3120, +1.4% 24h',
};

describe('buildModeBPrompt — body structure (angle-agnostic)', () => {
  it('instructs neutral signal extraction in body tweets', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    // Body must surface signals (facts / light implications) without verdict adjectives.
    expect(out).toMatch(/signal/i);
    expect(out).toMatch(/no directional adjectives/i);
  });

  it('caps thread length to the existing 4–10 floor/ceiling', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'skeptical' });
    expect(out).toMatch(/Never fewer than 4/);
    expect(out).toMatch(/Never more than 10/);
  });

  it('reminds the model to cite only facts in context', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bearish' });
    expect(out).toMatch(/Never invent|only use facts/i);
  });

  it('passes the user description and search/market context through', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    expect(out).toContain(baseInput.eventDescription);
    expect(out).toContain('commit-reveal mempool scheme');
    expect(out).toContain('ETH @ $3120');
  });
});

describe('buildModeBPrompt — angle-specific close', () => {
  it('bullish close instructs a 1-line net-bullish verdict', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    expect(out).toMatch(/net bullish/i);
    expect(out).toMatch(/no hedging/i);
  });

  it('bearish close instructs a 1-line net-bearish verdict', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bearish' });
    expect(out).toMatch(/net bearish/i);
    expect(out).toMatch(/no hedging/i);
  });

  it('skeptical close instructs a concrete evidence-test, not a verdict', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'skeptical' });
    expect(out).toMatch(/what would change my mind|evidence/i);
    expect(out).toMatch(/falsifiable|specific|concrete/i);
  });
});
