import { describe, it, expect } from 'vitest';
import { sumChainStats } from './publicStats';

describe('sumChainStats', () => {
  it('adds every chain into one scoreboard', () => {
    expect(
      sumChainStats([
        { threads: 3, volumeUsd: '0.30', x402Count: 4 },
        { threads: 55, volumeUsd: '2.75', x402Count: 102 },
      ]),
    ).toEqual({ threads: 58, volumeUsd: '3.05', x402Count: 106 });
  });

  // A chain that failed to answer must not take the other chain's numbers with
  // it — an outage should undercount, never blank the strip.
  it('skips a chain that failed instead of dropping the total', () => {
    expect(sumChainStats([null, { threads: 55, volumeUsd: '2.75', x402Count: 102 }])).toEqual({
      threads: 55,
      volumeUsd: '2.75',
      x402Count: 102,
    });
  });

  it('reports an empty total when no chain answered', () => {
    expect(sumChainStats([null, undefined])).toEqual({
      threads: 0,
      volumeUsd: '0.00',
      x402Count: 0,
    });
  });

  // One bad field used to be enough to render "$NaN" to every visitor.
  it('ignores a malformed volume rather than poisoning the sum', () => {
    expect(
      sumChainStats([
        { threads: 1, volumeUsd: 'oops', x402Count: 1 },
        { threads: 1, volumeUsd: '0.10', x402Count: 1 },
      ]),
    ).toEqual({ threads: 2, volumeUsd: '0.10', x402Count: 2 });
  });

  it('rounds a repeating float sum to cents', () => {
    expect(
      sumChainStats([
        { threads: 1, volumeUsd: '0.1', x402Count: 0 },
        { threads: 1, volumeUsd: '0.2', x402Count: 0 },
      ]).volumeUsd,
    ).toBe('0.30');
  });
});
