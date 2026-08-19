import { describe, it, expect } from 'vitest';
import { parseUnits } from 'viem';
import { payability } from './payability';
import type { TokenBalance } from './useBalances';

const USDC = (human: string): TokenBalance => ({
  symbol: 'USDC',
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  decimals: 6,
  displayName: 'USD Coin',
  balance: parseUnits(human, 6),
});

// The on-chain price, in the token's base units — what requiredAmount returns.
const PRICE = parseUnits('0.1', 6);

const base = { balancesLoading: false, balancesError: false };

describe('payability', () => {
  it('blocks an empty wallet without needing to know the price', () => {
    expect(payability({ ...base, token: USDC('0'), price: null })).toEqual({
      canPay: false,
      reason: 'empty',
    });
  });

  it('blocks a balance that cannot cover the price', () => {
    // The case that slips through today: non-zero, so the old `balance === 0n`
    // guard waves it past, and payForThread then reverts inside the wallet.
    expect(payability({ ...base, token: USDC('0.05'), price: PRICE })).toEqual({
      canPay: false,
      reason: 'short',
    });
  });

  it('allows a balance exactly equal to the price', () => {
    expect(payability({ ...base, token: USDC('0.1'), price: PRICE })).toEqual({ canPay: true });
  });

  it('allows a balance above the price', () => {
    expect(payability({ ...base, token: USDC('5'), price: PRICE })).toEqual({ canPay: true });
  });

  it('reports no-token when nothing is selected', () => {
    expect(payability({ ...base, token: null, price: PRICE })).toEqual({
      canPay: false,
      reason: 'no-token',
    });
  });

  it('does not block while the balances are still loading', () => {
    // Balances zero-fill before they arrive, and a disabled button would read
    // as "you are broke" to someone who is not.
    expect(
      payability({ token: USDC('0'), price: PRICE, balancesLoading: true, balancesError: false }),
    ).toEqual({ canPay: true });
  });

  it('does not block when the balance read failed', () => {
    // useBalances deliberately returns no balances on error rather than zeros,
    // so that "we could not check" never becomes "you have nothing".
    expect(
      payability({ token: USDC('0'), price: PRICE, balancesLoading: false, balancesError: true }),
    ).toEqual({ canPay: true });
  });

  it('does not block a funded wallet when the price could not be read', () => {
    // Never refuse a payment over a number we failed to verify — same bias as
    // the preflight gate.
    expect(payability({ ...base, token: USDC('0.05'), price: null })).toEqual({ canPay: true });
  });
});
