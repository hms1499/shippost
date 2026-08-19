import { describe, it, expect } from 'vitest';
import { parseUnits } from 'viem';
import { splitPaidAmount } from './paymentSplit';

describe('splitPaidAmount', () => {
  it('splits an evenly-divisible amount 50/40/10', () => {
    // $0.10 in cUSD (18 decimals) — the case where the old float math agreed,
    // which is why the bug went unnoticed.
    const amount = parseUnits('0.1', 18);
    expect(splitPaidAmount(amount)).toEqual({
      agent: parseUnits('0.05', 18),
      treasury: parseUnits('0.04', 18),
      reserve: parseUnits('0.01', 18),
    });
  });

  it('splits a 6-decimal token the same way', () => {
    // $0.05 in USDC — the price prod Celo actually charges.
    const amount = parseUnits('0.05', 6);
    expect(splitPaidAmount(amount)).toEqual({
      agent: 25_000n,
      treasury: 20_000n,
      reserve: 5_000n,
    });
  });

  it('rounds the dust into the reserve, exactly as the contract does', () => {
    // 7 base units: 3 / 2 / 2, not 3.5 / 2.8 / 0.7. The reserve gets the two
    // units the other two shares rounded away.
    expect(splitPaidAmount(7n)).toEqual({ agent: 3n, treasury: 2n, reserve: 2n });
  });

  it('always adds back up to the amount paid', () => {
    for (const amount of [0n, 1n, 3n, 7n, 999n, 12_345_678_901n, parseUnits('0.07', 18)]) {
      const s = splitPaidAmount(amount);
      expect(s.agent + s.treasury + s.reserve).toBe(amount);
    }
  });

  it('never gives the agent more than the contract would', () => {
    // Integer division truncates, so the agent share is a floor — the float
    // version could round it UP and over-report what the agent received.
    for (const amount of [1n, 3n, 7n, 99n, 101n]) {
      expect(splitPaidAmount(amount).agent).toBe((amount * 5000n) / 10_000n);
    }
  });

  it('handles zero without producing negative dust', () => {
    expect(splitPaidAmount(0n)).toEqual({ agent: 0n, treasury: 0n, reserve: 0n });
  });
});
