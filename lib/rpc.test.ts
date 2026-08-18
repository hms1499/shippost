import { describe, it, expect, afterEach, vi } from 'vitest';

const ORIG = { ...process.env };

async function loadRpc(env: Record<string, string | undefined>) {
  process.env = { ...ORIG };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  return import('./rpc');
}

afterEach(() => {
  process.env = { ...ORIG };
  vi.resetModules();
});

describe('rpcUrlsForChain', () => {
  it('includes a server BASE_RPC_URL override and keeps public fallbacks', async () => {
    // NEXT_PUBLIC_* is inlined from .env.local at transform time, so this
    // asserts the server-only override and that we never rely on one endpoint.
    const { rpcUrlsForChain } = await loadRpc({
      BASE_RPC_URL: 'https://my-base.example',
    });
    const urls = rpcUrlsForChain(8453);
    expect(urls).toContain('https://my-base.example');
    expect(urls).toContain('https://base-rpc.publicnode.com');
    expect(urls).toContain('https://mainnet.base.org');
  });

  it('never lists only the official Base endpoint (it rate-limits)', async () => {
    const { rpcUrlsForChain } = await loadRpc({
      NEXT_PUBLIC_BASE_RPC_URL: undefined,
      BASE_RPC_URL: undefined,
    });
    const urls = rpcUrlsForChain(8453);
    expect(urls.length).toBeGreaterThan(1);
    expect(urls[0]).not.toBe('https://mainnet.base.org');
  });

  it('dedupes when env repeats a public URL', async () => {
    const { rpcUrlsForChain } = await loadRpc({
      NEXT_PUBLIC_BASE_RPC_URL: 'https://base-rpc.publicnode.com',
      BASE_RPC_URL: 'https://base-rpc.publicnode.com',
    });
    const urls = rpcUrlsForChain(8453);
    expect(urls.filter((u) => u === 'https://base-rpc.publicnode.com')).toHaveLength(1);
  });
});
