import { describe, it, expect, vi } from 'vitest';
import { parseEther, parseGwei, parseUnits, type Address } from 'viem';
import { getTokens } from '../tokens';
import {
  checkAgentWalletBalance,
  checkReserveBalance,
  checkOrchestratorGas,
  checkSpendReadiness,
  minGasOverrideForChain,
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
    readGasPrice: () => Promise.resolve(parseGwei('200')),
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
    expect(health).toEqual({
      low: false,
      warn: false,
      native: 0.25,
      requiredNative: 0.05,
      address: OWNER,
    });
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

  it('prices the floor per chain, so one balance can be ample on Base and short on Celo', async () => {
    // 0.09 native. On Base at 0.006 gwei a thread's four settles cost ~0.0000021
    // ETH, so this is ample. On Celo at 200 gwei the same four cost ~0.088 CELO,
    // so it is not even one thread. No single constant can answer both.
    const same = parseEther('0.09');
    const onBase = await checkSpendReadiness({
      chainId: 8453,
      tokenSymbol: 'USDC',
      readers: {
        ...readiness({
          readNativeBalance: () => Promise.resolve(same),
          readGasPrice: () => Promise.resolve(parseGwei('0.006')),
        }),
        readDailyCap: () => Promise.resolve(parseUnits('10', 6)),
      },
    });
    const onCelo = await checkSpendReadiness({
      chainId: CHAIN,
      tokenSymbol: 'cUSD',
      readers: readiness({ readNativeBalance: () => Promise.resolve(same) }),
    });
    expect(onBase).toEqual({ ok: true });
    expect(onCelo).toEqual({ ok: false, reason: 'gas' });
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
    readers: { readOwner, readNativeBalance, readGasPrice: vi.fn() },
  });

  expect(health.low).toBe(true);
  expect(health.native).toBeCloseTo(0.001);
});

// ---------------------------------------------------------------------------
// The floor is denominated in gas units priced at check time, not in a fixed
// amount of native token. The fixed number was wrong in both directions from the
// same constant: 48x too strict on Base (it turned away a paying user whose
// signer still held ~43 threads of runway) and, at Celo's 200 gwei, below the
// cost of a single thread (so the gate waved through a run that could not
// finish, after taking the money).

// Base at its calm 0.006 gwei unless a test says otherwise.
function baseGas(nativeBalance: string, gwei = '0.006'): ReadinessReaders {
  return readiness({
    readNativeBalance: () => Promise.resolve(parseEther(nativeBalance)),
    readGasPrice: () => Promise.resolve(parseGwei(gwei)),
  });
}

describe('gas floor priced from gas units', () => {
  it('clears the exact Base balance the 0.0001 ETH floor rejected', async () => {
    const health = await checkOrchestratorGas({ chainId: 8453, readers: baseGas('0.000090509') });
    expect(health.low).toBe(false);
    expect(health.requiredNative).toBeCloseTo(0.0000132, 9);
  });

  it('blocks the Celo balance the 0.05 CELO floor let through', async () => {
    const health = await checkOrchestratorGas({
      chainId: CHAIN,
      readers: readiness({ readNativeBalance: () => Promise.resolve(parseEther('0.06')) }),
    });
    expect(health.low).toBe(true);
  });

  it('raises the requirement when gas price spikes', async () => {
    const calm = await checkOrchestratorGas({ chainId: 8453, readers: baseGas('0.0005') });
    const spike = await checkOrchestratorGas({ chainId: 8453, readers: baseGas('0.0005', '0.6') });
    expect(calm.low).toBe(false);
    expect(spike.low).toBe(true);
    expect(spike.requiredNative).toBeGreaterThan(calm.requiredNative);
  });

  it('never demands more than the per-chain ceiling, however absurd the gas price', async () => {
    const health = await checkOrchestratorGas({ chainId: 8453, readers: baseGas('1', '100000') });
    expect(health.requiredNative).toBe(0.001);
    expect(health.low).toBe(false);
  });

  it('still demands the per-chain minimum when the chain reports a zero gas price', async () => {
    const health = await checkOrchestratorGas({ chainId: 8453, readers: baseGas('0.000001', '0') });
    expect(health.requiredNative).toBe(0.000002);
    expect(health.low).toBe(true);
  });

  it('lets an explicit minNative win without reading the gas price at all', async () => {
    const readGasPrice = vi.fn();
    const health = await checkOrchestratorGas({
      chainId: 8453,
      minNative: 0.002,
      readers: {
        readOwner: () => Promise.resolve(OWNER),
        readNativeBalance: () => Promise.resolve(parseEther('0.001')),
        readGasPrice,
      },
    });
    expect(health.low).toBe(true);
    expect(health.requiredNative).toBe(0.002);
    expect(readGasPrice).not.toHaveBeenCalled();
  });
});

// A page that fires at the same threshold that already blocks every user is not
// a warning, it is an outage notice. The band sits above the blocking floor so
// there is still time to top up.
describe('gas warning band', () => {
  it('warns while the signer is still above the blocking floor', async () => {
    // required 0.0000132, band 3x = 0.0000396
    const health = await checkOrchestratorGas({ chainId: 8453, readers: baseGas('0.00003') });
    expect(health.low).toBe(false);
    expect(health.warn).toBe(true);
  });

  it('stays quiet on a comfortably funded signer', async () => {
    const health = await checkOrchestratorGas({ chainId: 8453, readers: baseGas('0.0005') });
    expect(health.low).toBe(false);
    expect(health.warn).toBe(false);
  });

  it('reports an already-blocked signer as low rather than warned', async () => {
    const health = await checkOrchestratorGas({ chainId: 8453, readers: baseGas('0.000001') });
    expect(health.low).toBe(true);
    expect(health.warn).toBe(false);
  });
});

// The override existed but reached the cron alert only, so the blocking floor
// could not be retuned on prod without a deploy. It is per-chain because one
// shared number would apply an ETH-scaled floor to CELO.
describe('minGasOverrideForChain', () => {
  it('reads the override for that chain and leaves other chains computed', () => {
    vi.stubEnv('ORCHESTRATOR_MIN_GAS_NATIVE_8453', '0.0005');
    expect(minGasOverrideForChain(8453)).toBe(0.0005);
    expect(minGasOverrideForChain(CHAIN)).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('ignores a value that is unparseable or non-positive', async () => {
    for (const bad of ['not-a-number', '', '0', '-1']) {
      vi.stubEnv('ORCHESTRATOR_MIN_GAS_NATIVE_8453', bad);
      expect(minGasOverrideForChain(8453)).toBeUndefined();
    }
    vi.unstubAllEnvs();
  });
});
