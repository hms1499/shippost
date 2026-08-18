import { describe, it, expect } from 'vitest';
import { base, celo } from 'wagmi/chains';
import { wagmiConfig } from './wagmi';
import { SUPPORTED_CHAIN_IDS, DEFAULT_CHAIN_ID } from './chainPolicy';

// MiniPay only surfaces window.ethereum (EIP-1193, no EIP-6963 announcement),
// so auto-connect in HomeClient depends on a connector with id 'injected'
// existing in the config. RainbowKit's default wallet list does not include
// one — it must be added explicitly.
describe('wagmiConfig', () => {
  it('exposes an injected connector for MiniPay auto-connect', () => {
    const ids = wagmiConfig.connectors.map((c) => c.id);
    expect(ids).toContain('injected');
  });
});

describe('multi-chain config', () => {
  it('registers every supported chain, default first', () => {
    const ids = wagmiConfig.chains.map((c) => c.id);
    expect(ids).toContain(base.id);
    expect(ids).toContain(celo.id);
    expect(ids[0]).toBe(DEFAULT_CHAIN_ID);
  });

  it('registers exactly the allowlist, nothing more', () => {
    const ids = [...wagmiConfig.chains.map((c) => c.id)].sort((a, b) => a - b);
    expect(ids).toEqual([...SUPPORTED_CHAIN_IDS].sort((a, b) => a - b));
  });

  // A chain registered without a transport looks supported to the UI and then
  // fails on the first RPC call.
  it('has a transport for every registered chain', () => {
    for (const c of wagmiConfig.chains) {
      expect(wagmiConfig._internal.transports[c.id]).toBeDefined();
    }
  });
});

describe('rpc fallbacks', () => {
  it('does not pin Base to only mainnet.base.org', async () => {
    const { rpcUrlsForChain } = await import('./rpc');
    const urls = rpcUrlsForChain(base.id);
    expect(urls.length).toBeGreaterThan(1);
    expect(urls[0]).not.toBe('https://mainnet.base.org');
  });
});
