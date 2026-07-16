import { describe, it, expect } from 'vitest';
import { buildNewsBreakdownPrompt } from './newsReaction';

describe('buildNewsBreakdownPrompt', () => {
  const base = {
    event: 'SEC approved spot ETH ETFs on May 23',
    searchSummary: null,
    marketSnippet: null,
  };

  it('contains the four beats and the news line', () => {
    const p = buildNewsBreakdownPrompt(base);
    expect(p).toContain('what just happened');
    expect(p).toContain('why it matters');
    expect(p).toContain('who is affected');
    expect(p).toContain('what to watch');
    expect(p).toContain('SEC approved spot ETH ETFs');
  });

  it('carries the neutrality constraints', () => {
    const p = buildNewsBreakdownPrompt(base);
    expect(p).toContain('Never pick a side');
    expect(p).toContain('No investment recommendation');
    expect(p).toContain('likely');
  });

  it('marks missing search context instead of dropping the block', () => {
    expect(buildNewsBreakdownPrompt(base)).toContain('none returned');
  });

  it('includes search and market blocks when provided', () => {
    const p = buildNewsBreakdownPrompt({ event: 'e', searchSummary: 'S1', marketSnippet: 'M1' });
    expect(p).toContain('S1');
    expect(p).toContain('Market data:\nM1');
  });

  it('omits the market block when snippet is null', () => {
    expect(buildNewsBreakdownPrompt(base)).not.toContain('Market data:');
  });
});
