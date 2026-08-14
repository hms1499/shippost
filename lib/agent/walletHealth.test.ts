import { describe, it, expect, vi } from 'vitest';
import { parseEther, parseUnits, type Address } from 'viem';
import { getTokens } from '../tokens';
import {
  checkAgentWalletBalance,
  checkReserveBalance,
  checkOrchestratorGas,
  checkSpendReadiness,
  type ReadinessReaders,
} from './walletHealth';

const CHAIN = 42220; // Celo mainnet
const T = getTokens(CHAIN);

// Build an injected reader from a per-symbol human-USD map, honoring each
// token's decimals (cUSD 18, USDT/USDC 6).
function readerFrom(usd: Record<'cUSD' | 'USDT' | 'USDC', string>) {
  const byAddress = new Map<string, bigint>([
    [T.cUSD!.address.toLowerCase(), parseUnits(usd.cUSD, T.cUSD!.decimals)],
    [T.USDT!.address.toLowerCase(), parseUnits(usd.USDT, T.USDT!.decimals)],
    [T.USDC!.address.toLowerCase(), parseUnits(usd.USDC, T.USDC!.decimals)],
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

const OWNER = '0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78' as Address;

// A healthy wallet: unpaused, funded orchestrator, full $10 cap untouched.
function readiness(overrides: Partial<ReadinessReaders> = {}): ReadinessReaders {
  return {
    readPaused: () => Promise.resolve(false),
    readOwner: () => Promise.resolve(OWNER),
    readNativeBalance: () => Promise.resolve(parseEther('1')),
    readDailyCap: (token) =>
      Promise.resolve(parseUnits('10', token === T.cUSD!.address ? 18 : 6)),
    readSpentToday: () => Promise.resolve(0n),
    ...overrides,
  };
}

describe('checkOrchestratorGas', () => {
  it('reports the on-chain owner and its balance in human native units', async () => {
    const health = await checkOrchestratorGas({
      chainId: CHAIN,
      minNative: 0.05,
      readers: readiness({ readNativeBalance: () => Promise.resolve(parseEther('0.25')) }),
    });
    expect(health).toEqual({ low: false, native: 0.25, address: OWNER });
  });

  it('flags a signer below the floor', async () => {
    const health = await checkOrchestratorGas({
      chainId: CHAIN,
      minNative: 0.05,
      readers: readiness({ readNativeBalance: () => Promise.resolve(parseEther('0.004')) }),
    });
    expect(health.low).toBe(true);
    expect(health.native).toBe(0.004);
  });
});

describe('checkSpendReadiness', () => {
  it('is ready when the wallet is unpaused, funded, and under cap', async () => {
    expect(
      await checkSpendReadiness({ chainId: CHAIN, tokenSymbol: 'cUSD', readers: readiness() }),
    ).toEqual({ ok: true });
  });

  it('is not ready while the AgentWallet kill-switch is engaged', async () => {
    const r = await checkSpendReadiness({
      chainId: CHAIN,
      tokenSymbol: 'USDT',
      readers: readiness({ readPaused: () => Promise.resolve(true) }),
    });
    expect(r).toEqual({ ok: false, reason: 'paused' });
  });

  it('is not ready when the orchestrator EOA is out of gas', async () => {
    const r = await checkSpendReadiness({
      chainId: CHAIN,
      tokenSymbol: 'USDC',
      readers: readiness({ readNativeBalance: () => Promise.resolve(parseEther('0.001')) }),
    });
    expect(r).toEqual({ ok: false, reason: 'gas' });
  });

  it('reads gas for the on-chain owner, never a configured address', async () => {
    let askedFor: Address | null = null;
    await checkSpendReadiness({
      chainId: CHAIN,
      tokenSymbol: 'cUSD',
      readers: readiness({
        readNativeBalance: (a) => {
          askedFor = a;
          return Promise.resolve(parseEther('1'));
        },
      }),
    });
    expect(askedFor).toBe(OWNER);
  });

  it('treats gas exactly at the floor as ready (strictly below is low)', async () => {
    const r = await checkSpendReadiness({
      chainId: CHAIN,
      tokenSymbol: 'cUSD',
      minGasNative: 0.05,
      readers: readiness({ readNativeBalance: () => Promise.resolve(parseEther('0.05')) }),
    });
    expect(r).toEqual({ ok: true });
  });

  it('is not ready when the remaining daily cap cannot cover a whole thread', async () => {
    // $10 cap with $9.9985 spent leaves $0.0015 — less than the 4 x $0.001 a
    // worst-case thread (mode B) needs, so the thread could die mid-run.
    const r = await checkSpendReadiness({
      chainId: CHAIN,
      tokenSymbol: 'USDT',
      readers: readiness({ readSpentToday: () => Promise.resolve(parseUnits('9.9985', 6)) }),
    });
    expect(r).toEqual({ ok: false, reason: 'cap' });
  });

  it('is ready when the remaining cap covers exactly one worst-case thread', async () => {
    const r = await checkSpendReadiness({
      chainId: CHAIN,
      tokenSymbol: 'USDT',
      readers: readiness({ readSpentToday: () => Promise.resolve(parseUnits('9.996', 6)) }),
    });
    expect(r).toEqual({ ok: true });
  });

  it('catches an unset cap, which would revert every thread in that token', async () => {
    // dailySpendCap defaults to 0 for a token whose cap was never set — every
    // executeX402Call in it reverts CAP_EXCEEDED. Must be caught before paying.
    const r = await checkSpendReadiness({
      chainId: CHAIN,
      tokenSymbol: 'USDC',
      readers: readiness({ readDailyCap: () => Promise.resolve(0n) }),
    });
    expect(r).toEqual({ ok: false, reason: 'cap' });
  });

  it('reports paused first when several conditions fail at once', async () => {
    const r = await checkSpendReadiness({
      chainId: CHAIN,
      tokenSymbol: 'cUSD',
      readers: readiness({
        readPaused: () => Promise.resolve(true),
        readNativeBalance: () => Promise.resolve(0n),
        readDailyCap: () => Promise.resolve(0n),
      }),
    });
    expect(r).toEqual({ ok: false, reason: 'paused' });
  });

  it('never consults the AgentWallet token balance', async () => {
    // The 50% split delivers $0.025 of the paid token before generate runs, so
    // balance is not the predicate — and mainnet cUSD sits at 0 today, which a
    // balance check would wrongly treat as "cannot pay".
    const readers = readiness();
    expect(readers).not.toHaveProperty('readBalanceOf');
    expect(
      await checkSpendReadiness({ chainId: CHAIN, tokenSymbol: 'cUSD', readers }),
    ).toEqual({ ok: true });
  });
});

// An ETH threshold is not a CELO threshold, and the parameter name was the only
// thing saying otherwise.
it('uses minNative for the gas floor', async () => {
  const readOwner = vi.fn().mockResolvedValue(OWNER);
  const readNativeBalance = vi.fn().mockResolvedValue(parseEther('0.001'));

  const health = await checkOrchestratorGas({
    chainId: 8453,
    minNative: 0.002,
    readers: { readOwner, readNativeBalance },
  });

  expect(health.low).toBe(true);
  expect(health.native).toBeCloseTo(0.001);
});
