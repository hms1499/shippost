import { describe, it, expect, afterEach, vi } from 'vitest';

// chainPolicy reads env at module load, so each case needs a fresh module.
async function loadPolicy(env: Record<string, string | undefined>) {
  const prev = { ...process.env };
  Object.assign(process.env, env);
  vi.resetModules();
  const mod = await import('./chainPolicy');
  process.env = prev;
  return mod;
}

// A bare .sort() compares numbers as strings, which puts 42220 before 8453.
const ascending = (ids: readonly number[]) => [...ids].sort((a, b) => a - b);

describe('chainPolicy', () => {
  afterEach(() => vi.resetModules());

  it('defaults to Base mainnet plus Celo mainnet', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: undefined,
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: undefined,
    });
    expect(p.DEFAULT_CHAIN_ID).toBe(8453);
    expect(ascending(p.SUPPORTED_CHAIN_IDS)).toEqual([8453, 42220]);
  });

  it('reads an explicit allowlist from env', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '84532,11142220',
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: '84532',
    });
    expect(ascending(p.SUPPORTED_CHAIN_IDS)).toEqual([84532, 11142220]);
    expect(p.DEFAULT_CHAIN_ID).toBe(84532);
  });

  // An unknown id in the env list is dropped rather than trusted: a typo must
  // not put the app on a chain with no contracts or tokens configured.
  it('drops ids it does not know about', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '8453,1,999999',
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: undefined,
    });
    expect([...p.SUPPORTED_CHAIN_IDS]).toEqual([8453]);
  });

  it('falls back to the built-in list when env leaves nothing valid', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '1,2,3',
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: undefined,
    });
    expect(ascending(p.SUPPORTED_CHAIN_IDS)).toEqual([8453, 42220]);
  });

  it('rejects unsupported and undefined chains', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '8453',
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: undefined,
    });
    expect(p.isSupportedChain(8453)).toBe(true);
    expect(p.isSupportedChain(1)).toBe(false);
    expect(p.isSupportedChain(undefined)).toBe(false);
    expect(p.isSupportedChain(NaN)).toBe(false);
  });

  it('falls back to the default when the env default is not in the allowlist', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '42220',
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: '8453',
    });
    // A default outside the allowlist would strand every user on an
    // unsupported chain, so the allowlist wins.
    expect(p.DEFAULT_CHAIN_ID).toBe(42220);
  });

  it('labels and flags testnets', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '8453,42220,84532,11142220',
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: undefined,
    });
    expect(p.chainLabel(8453)).toBe('Base');
    expect(p.chainLabel(42220)).toBe('Celo');
    expect(p.chainLabel(84532)).toBe('Base Sepolia (testnet)');
    expect(p.chainLabel(11142220)).toBe('Celo Sepolia (testnet)');
    expect(p.isTestnet(84532)).toBe(true);
    expect(p.isTestnet(8453)).toBe(false);
  });

  // MiniPay exposes no wallet_switchEthereumChain, so the UI must never offer
  // switchChain there. Anything non-Celo is not MiniPay.
  it('flags the MiniPay chains', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: '8453,42220,84532,11142220',
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: undefined,
    });
    expect(p.isMiniPayChain(42220)).toBe(true);
    expect(p.isMiniPayChain(11142220)).toBe(true);
    expect(p.isMiniPayChain(8453)).toBe(false);
    expect(p.isMiniPayChain(84532)).toBe(false);
  });

  it('skips Model-1 soft settles on Base, keeps them on Celo', async () => {
    const p = await loadPolicy({
      NEXT_PUBLIC_SUPPORTED_CHAIN_IDS: undefined,
      NEXT_PUBLIC_DEFAULT_CHAIN_ID: undefined,
    });
    expect(p.settlesSoftStepsOnChain(8453)).toBe(false);
    expect(p.settlesSoftStepsOnChain(84532)).toBe(false);
    expect(p.settlesSoftStepsOnChain(42220)).toBe(true);
    expect(p.settlesSoftStepsOnChain(11142220)).toBe(true);
  });
});
