import { describe, it, expect } from 'vitest';
import { buildDailyRecapPrompt } from './dailyRecap';

describe('buildDailyRecapPrompt', () => {
  it('embeds market data when provided and forbids inventing numbers', () => {
    const p = buildDailyRecapPrompt({
      marketSnippet: 'BTC $67,420 (-1.2% 24h)\nETH $3,511 (+0.4% 24h)',
      searchSummary: null,
    });
    expect(p).toContain('BTC $67,420');
    expect(p).toContain('NEVER invent');
  });

  it('warns the model off numbers when market data is absent', () => {
    const p = buildDailyRecapPrompt({ marketSnippet: null, searchSummary: null });
    expect(p).toContain('Do NOT state any prices');
  });

  it('embeds the search context when provided', () => {
    const p = buildDailyRecapPrompt({
      marketSnippet: null,
      searchSummary: '- ETF flows turned positive on Tuesday.',
    });
    expect(p).toContain('ETF flows turned positive');
  });

  it('asks for a neutral digest with a watch-item close', () => {
    const p = buildDailyRecapPrompt({ marketSnippet: 'x', searchSummary: 'y' });
    expect(p).toContain('one thing to watch');
    expect(p).toContain('not a take');
  });

  it('ends with the output-only instruction', () => {
    const p = buildDailyRecapPrompt({ marketSnippet: 'x', searchSummary: 'y' });
    expect(p.trim().endsWith('Output only the numbered tweets separated by blank lines. Nothing else.')).toBe(true);
  });
});
