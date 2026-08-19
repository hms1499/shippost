import { describe, it, expect } from 'vitest';
import { celo, base } from 'wagmi/chains';
import { parseUnits } from 'viem';
import {
  computeTokenAmount,
  computeX402CostAmount,
  formatPriceLabel,
  getTokens,
  THREAD_PRICE_USD,
  X402_UNIT_COST_USD,
} from './tokens';

// The x402 micro-charge must scale to each token's own decimals. Hardcoding
// 1e15 (18-decimal cUSD units) for 6-decimal USDT/USDC was the class of bug that
// would try to move 1e9 tokens — well past balance and the daily cap.
describe('computeX402CostAmount', () => {
  // getTokens is a partial map now (Base has no cUSD), but Celo mainnet does
  // carry all three, so the assertions here are safe.
  const T = getTokens(celo.id);

  it('is 0.001 USD across all tokens', () => {
    expect(X402_UNIT_COST_USD).toBe('0.001');
  });

  it('scales cUSD to 18 decimals (0.001 = 1e15)', () => {
    expect(computeX402CostAmount(T.cUSD!)).toBe(1_000_000_000_000_000n);
  });

  it('scales USDT to 6 decimals (0.001 = 1000)', () => {
    expect(computeX402CostAmount(T.USDT!)).toBe(1000n);
  });

  it('scales USDC to 6 decimals (0.001 = 1000)', () => {
    expect(computeX402CostAmount(T.USDC!)).toBe(1000n);
  });

  it('never produces the 18-decimal amount for a 6-decimal token', () => {
    expect(computeX402CostAmount(T.USDT!)).not.toBe(computeX402CostAmount(T.cUSD!));
  });
});

describe('Base tokens', () => {
  it('exposes USDC on Base at 6 decimals', () => {
    const t = getTokens(base.id);
    expect(t.USDC?.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(t.USDC?.decimals).toBe(6);
  });

  it('has no cUSD on Base — the symbol simply does not exist there', () => {
    expect(getTokens(base.id).cUSD).toBeUndefined();
  });

  it('does not ship USDT on Base yet', () => {
    expect(getTokens(base.id).USDT).toBeUndefined();
  });

  it('still returns all three on Celo mainnet', () => {
    const t = getTokens(celo.id);
    expect(Object.keys(t).sort()).toEqual(['USDC', 'USDT', 'cUSD']);
  });
});

describe('thread price', () => {
  it('is $0.10', () => {
    expect(THREAD_PRICE_USD).toBe(0.1);
  });

  it('scales to 6 decimals (0.10 = 100000)', () => {
    expect(computeTokenAmount(getTokens(base.id).USDC!)).toBe(100_000n);
  });

  it('scales to 18 decimals (0.10 = 1e17)', () => {
    expect(computeTokenAmount(getTokens(42220).cUSD!)).toBe(100_000_000_000_000_000n);
  });
});

describe('formatPriceLabel', () => {
  it('labels a chain-read price the same shape as the constant', () => {
    // prod Celo charges $0.05 while THREAD_PRICE_LABEL says $0.10 — this is the
    // function that lets the real figure take its place.
    expect(formatPriceLabel(parseUnits('0.05', 18), 18)).toBe('$0.05');
    expect(formatPriceLabel(parseUnits('0.1', 6), 6)).toBe('$0.10');
  });

  it('does not round a sub-cent amount up to a cent', () => {
    expect(formatPriceLabel(parseUnits('0.001', 6), 6)).toBe('$0.001');
  });

  it('handles zero', () => {
    expect(formatPriceLabel(0n, 18)).toBe('$0');
  });
});
