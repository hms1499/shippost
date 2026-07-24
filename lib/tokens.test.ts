import { describe, it, expect } from 'vitest';
import { celo } from 'wagmi/chains';
import { computeX402CostAmount, getTokens, X402_UNIT_COST_USD } from './tokens';

// The x402 micro-charge must scale to each token's own decimals. Hardcoding
// 1e15 (18-decimal cUSD units) for 6-decimal USDT/USDC was the class of bug that
// would try to move 1e9 tokens — well past balance and the daily cap.
describe('computeX402CostAmount', () => {
  const T = getTokens(celo.id);

  it('is 0.001 USD across all tokens', () => {
    expect(X402_UNIT_COST_USD).toBe('0.001');
  });

  it('scales cUSD to 18 decimals (0.001 = 1e15)', () => {
    expect(computeX402CostAmount(T.cUSD)).toBe(1_000_000_000_000_000n);
  });

  it('scales USDT to 6 decimals (0.001 = 1000)', () => {
    expect(computeX402CostAmount(T.USDT)).toBe(1000n);
  });

  it('scales USDC to 6 decimals (0.001 = 1000)', () => {
    expect(computeX402CostAmount(T.USDC)).toBe(1000n);
  });

  it('never produces the 18-decimal amount for a 6-decimal token', () => {
    expect(computeX402CostAmount(T.USDT)).not.toBe(computeX402CostAmount(T.cUSD));
  });
});
