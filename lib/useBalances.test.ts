import { describe, it, expect } from 'vitest';
import { base, celo } from 'wagmi/chains';
import { tokenListFor } from './useBalances';

describe('tokenListFor', () => {
  it('lists the one token Base accepts', () => {
    expect(tokenListFor(base.id).map((t) => t.symbol)).toEqual(['USDC']);
  });

  it('lists all three Celo accepts', () => {
    expect(tokenListFor(celo.id).map((t) => t.symbol).sort()).toEqual([
      'USDC',
      'USDT',
      'cUSD',
    ]);
  });

  it('returns empty for an unsupported chain instead of throwing', () => {
    expect(tokenListFor(1)).toEqual([]);
  });

  it('returns empty when the chain is not known yet', () => {
    expect(tokenListFor(undefined)).toEqual([]);
  });
});
