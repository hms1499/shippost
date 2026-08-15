import { describe, it, expect } from 'vitest';
import { base, celo } from 'wagmi/chains';
import {
  normalizeTo18,
  highestValue,
  reselectTokenForChain,
} from './chainChoice';

const cUSD = { symbol: 'cUSD' as const, decimals: 18 };
const USDC = { symbol: 'USDC' as const, decimals: 6 };
const USDT = { symbol: 'USDT' as const, decimals: 6 };

// 0.30 cUSD and 2.40 USDC — the case the raw-bigint sort gets backwards.
const THIRTY_CENTS_CUSD = 300_000_000_000_000_000n;
const TWO_FORTY_USDC = 2_400_000n;

describe('normalizeTo18', () => {
  it('leaves an 18-decimal balance alone', () => {
    expect(normalizeTo18(THIRTY_CENTS_CUSD, 18)).toBe(THIRTY_CENTS_CUSD);
  });

  it('scales a 6-decimal balance up to the same unit', () => {
    expect(normalizeTo18(TWO_FORTY_USDC, 6)).toBe(2_400_000_000_000_000_000n);
  });

  it('scales down if a token ever has more than 18 decimals', () => {
    expect(normalizeTo18(1_000n, 21)).toBe(1n);
  });
});

describe('highestValue', () => {
  it('picks by real value, not raw bigint', () => {
    const top = highestValue([
      { ...cUSD, balance: THIRTY_CENTS_CUSD },
      { ...USDC, balance: TWO_FORTY_USDC },
    ]);
    expect(top?.symbol).toBe('USDC');
  });

  it('returns null when every balance is zero', () => {
    expect(
      highestValue([
        { ...cUSD, balance: 0n },
        { ...USDC, balance: 0n },
      ]),
    ).toBeNull();
  });

  it('returns null for an empty list', () => {
    expect(highestValue([])).toBeNull();
  });
});

describe('reselectTokenForChain', () => {
  it('keeps the symbol when it exists on the new chain', () => {
    const out = reselectTokenForChain({
      previousSymbol: 'USDC',
      chainId: base.id,
      balances: [{ ...USDC, balance: TWO_FORTY_USDC }],
    });
    expect(out).toEqual({ kind: 'keep', symbol: 'USDC' });
  });

  it('falls back to the most valuable funded token when the symbol is gone', () => {
    const out = reselectTokenForChain({
      previousSymbol: 'cUSD',
      chainId: base.id,
      balances: [{ ...USDC, balance: TWO_FORTY_USDC }],
    });
    expect(out.kind).toBe('switched');
    if (out.kind === 'switched') {
      expect(out.symbol).toBe('USDC');
      expect(out.token.address).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    }
  });

  it('ignores a funded token that does not exist on the target chain', () => {
    // cUSD is funded but Base has no cUSD — it must not be chosen.
    const out = reselectTokenForChain({
      previousSymbol: 'USDT',
      chainId: base.id,
      balances: [
        { ...cUSD, balance: THIRTY_CENTS_CUSD },
        { ...USDC, balance: TWO_FORTY_USDC },
      ],
    });
    expect(out.kind).toBe('switched');
    if (out.kind === 'switched') expect(out.symbol).toBe('USDC');
  });

  it('reports none when nothing on the new chain is funded', () => {
    const out = reselectTokenForChain({
      previousSymbol: 'cUSD',
      chainId: base.id,
      balances: [{ ...USDC, balance: 0n }],
    });
    expect(out).toEqual({ kind: 'none' });
  });

  it('reports none rather than throwing on an unsupported chain', () => {
    const out = reselectTokenForChain({
      previousSymbol: 'USDC',
      chainId: 1,
      balances: [{ ...USDC, balance: TWO_FORTY_USDC }],
    });
    expect(out).toEqual({ kind: 'none' });
  });

  it('keeps a symbol that exists on the chain even with no balance loaded yet', () => {
    // Balances arrive asynchronously; a keep must not depend on them.
    const out = reselectTokenForChain({
      previousSymbol: 'USDC',
      chainId: celo.id,
      balances: [],
    });
    expect(out).toEqual({ kind: 'keep', symbol: 'USDC' });
  });
});
