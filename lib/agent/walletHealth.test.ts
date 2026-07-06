import { describe, it, expect } from 'vitest';
import { parseUnits, type Address } from 'viem';
import { getTokens } from '../tokens';
import { checkAgentWalletBalance, checkReserveBalance } from './walletHealth';

const CHAIN = 42220; // Celo mainnet
const T = getTokens(CHAIN);

// Build an injected reader from a per-symbol human-USD map, honoring each
// token's decimals (cUSD 18, USDT/USDC 6).
function readerFrom(usd: Record<'cUSD' | 'USDT' | 'USDC', string>) {
  const byAddress = new Map<string, bigint>([
    [T.cUSD.address.toLowerCase(), parseUnits(usd.cUSD, T.cUSD.decimals)],
    [T.USDT.address.toLowerCase(), parseUnits(usd.USDT, T.USDT.decimals)],
    [T.USDC.address.toLowerCase(), parseUnits(usd.USDC, T.USDC.decimals)],
  ]);
  return (tokenAddress: Address) => Promise.resolve(byAddress.get(tokenAddress.toLowerCase()) ?? 0n);
}

describe('checkAgentWalletBalance', () => {
  it('flags only the tokens below the threshold and reports formatted balances', async () => {
    const health = await checkAgentWalletBalance({
      chainId: CHAIN,
      minUsd: 2,
      readBalanceOf: readerFrom({ cUSD: '5', USDT: '0.3', USDC: '10' }),
    });
    expect(health.low).toEqual(['USDT']);
    expect(health.balances).toEqual({ cUSD: 5, USDT: 0.3, USDC: 10 });
  });

  it('returns an empty low list when every token is healthy', async () => {
    const health = await checkAgentWalletBalance({
      chainId: CHAIN,
      minUsd: 2,
      readBalanceOf: readerFrom({ cUSD: '5', USDT: '5', USDC: '5' }),
    });
    expect(health.low).toEqual([]);
  });

  it('flags every token when all are drained', async () => {
    const health = await checkAgentWalletBalance({
      chainId: CHAIN,
      minUsd: 2,
      readBalanceOf: readerFrom({ cUSD: '0', USDT: '0', USDC: '0' }),
    });
    expect(health.low.sort()).toEqual(['USDC', 'USDT', 'cUSD']);
  });

  it('treats a balance exactly at the threshold as healthy (strictly below is low)', async () => {
    const health = await checkAgentWalletBalance({
      chainId: CHAIN,
      minUsd: 2,
      readBalanceOf: readerFrom({ cUSD: '2', USDT: '1.99', USDC: '2' }),
    });
    expect(health.low).toEqual(['USDT']);
  });

  it('checkReserveBalance flags low reserve tokens the same way', async () => {
    const health = await checkReserveBalance({
      chainId: CHAIN,
      minUsd: 0.5,
      readBalanceOf: readerFrom({ cUSD: '1', USDT: '0.1', USDC: '2' }),
    });
    expect(health.low).toEqual(['USDT']);
    expect(health.balances).toEqual({ cUSD: 1, USDT: 0.1, USDC: 2 });
  });
});
