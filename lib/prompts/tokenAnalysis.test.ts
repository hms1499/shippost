import { describe, it, expect } from 'vitest';
import { normalizeTicker, buildTokenAnalysisPrompt } from './tokenAnalysis';

describe('normalizeTicker', () => {
  it('adds a leading $ and uppercases', () => {
    expect(normalizeTicker('celo')).toBe('$CELO');
  });

  it('collapses an existing $ and trims whitespace', () => {
    expect(normalizeTicker('  $btc ')).toBe('$BTC');
  });

  it('cuts at the first non-alphanumeric char', () => {
    expect(normalizeTicker('ETH/USD')).toBe('$ETH');
  });

  it('caps the body at 6 chars', () => {
    expect(normalizeTicker('superlongticker')).toBe('$SUPERL');
  });

  it('returns a bare $ for empty/garbage input', () => {
    expect(normalizeTicker('   ')).toBe('$');
    expect(normalizeTicker('$$$')).toBe('$');
  });
});

describe('buildTokenAnalysisPrompt', () => {
  const base = { ticker: '$CELO', angle: 'bullish' as const };

  it('includes the ticker and the angle close rule', () => {
    const p = buildTokenAnalysisPrompt({ ...base, searchSummary: null, marketSnippet: null });
    expect(p).toContain('Ticker: $CELO');
    expect(p).toContain('net bullish on');
  });

  it('embeds market data when provided and forbids inventing numbers', () => {
    const p = buildTokenAnalysisPrompt({
      ...base,
      marketSnippet: '$CELO @ $0.50, 2.00% 24h, mcap ~$280.0M',
      searchSummary: null,
    });
    expect(p).toContain('$CELO @ $0.50');
    expect(p).toContain('NEVER invent');
  });

  it('warns the model off numbers when market data is absent', () => {
    const p = buildTokenAnalysisPrompt({ ...base, marketSnippet: null, searchSummary: null });
    expect(p).toContain('do NOT state any price');
  });

  it('ends with the output-only instruction', () => {
    const p = buildTokenAnalysisPrompt({ ...base, searchSummary: 'x', marketSnippet: 'y' });
    expect(p.trim().endsWith('Output only the numbered tweets separated by blank lines. Nothing else.')).toBe(true);
  });
});

describe('buildTokenAnalysisPrompt — hook', () => {
  it('invites a hook and drops the question-opener ban', () => {
    const out = buildTokenAnalysisPrompt({ ticker: '$CELO', angle: 'skeptical', searchSummary: null, marketSnippet: null });
    expect(out).toMatch(/hook/i);
    expect(out).not.toMatch(/No question opener/i);
  });
});
