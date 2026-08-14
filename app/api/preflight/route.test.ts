import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const checkSpendReadiness = vi.fn();
vi.mock('@/lib/agent/walletHealth', () => ({ checkSpendReadiness }));

import { DEFAULT_CHAIN_ID } from '@/lib/chainPolicy';

// Fresh module per test so the in-process cache never leaks between cases.
async function load() {
  vi.resetModules();
  return (await import('./route')).GET;
}

// Celo mainnet by default: it carries all three tokens, so the caching and
// fail-open cases below stay about caching and fail-open. The chain-specific
// behaviour has its own describe block.
const CELO = 42220;

function req(token?: string, chainId: number | string = CELO): Request {
  const url = new URL('http://localhost/api/preflight');
  if (token !== undefined) url.searchParams.set('token', token);
  url.searchParams.set('chainId', String(chainId));
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  checkSpendReadiness.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/preflight', () => {
  it('reports ready', async () => {
    const GET = await load();
    const res = await GET(req('cUSD'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('reports not-ready with the reason, still HTTP 200', async () => {
    // Not-ready is a valid answer to a valid question. A non-2xx would be
    // indistinguishable from the outage case, which must fail open.
    checkSpendReadiness.mockResolvedValue({ ok: false, reason: 'paused' });
    const GET = await load();
    const res = await GET(req('USDT'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, reason: 'paused' });
  });

  it('400s an unknown token without touching the chain', async () => {
    const GET = await load();
    const res = await GET(req('DAI'));
    expect(res.status).toBe(400);
    expect(checkSpendReadiness).not.toHaveBeenCalled();
  });

  it('400s a missing token', async () => {
    const GET = await load();
    expect((await GET(req())).status).toBe(400);
    expect(checkSpendReadiness).not.toHaveBeenCalled();
  });

  it('fails OPEN when the readiness read throws', async () => {
    // A preflight outage must never freeze revenue — the backstop is the
    // invariant that every post-payment failure is clean and refundable.
    checkSpendReadiness.mockRejectedValue(new Error('rpc down'));
    const GET = await load();
    const res = await GET(req('cUSD'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('caches a real answer so opening preview does not hammer the RPC', async () => {
    const GET = await load();
    await GET(req('cUSD'));
    await GET(req('cUSD'));
    expect(checkSpendReadiness).toHaveBeenCalledOnce();
  });

  it('caches per token', async () => {
    const GET = await load();
    await GET(req('cUSD'));
    await GET(req('USDT'));
    expect(checkSpendReadiness).toHaveBeenCalledTimes(2);
  });

  it('re-reads once the cache entry expires', async () => {
    vi.useFakeTimers();
    const GET = await load();
    await GET(req('cUSD'));
    vi.advanceTimersByTime(31_000);
    await GET(req('cUSD'));
    expect(checkSpendReadiness).toHaveBeenCalledTimes(2);
  });

  it('does not cache the fail-open answer', async () => {
    // Caching a fail-open "ok" would keep serving it for the whole TTL after
    // the RPC recovers, hiding a genuinely unready wallet.
    checkSpendReadiness.mockRejectedValueOnce(new Error('rpc down'));
    const GET = await load();
    expect(await (await GET(req('cUSD'))).json()).toEqual({ ok: true });
    checkSpendReadiness.mockResolvedValue({ ok: false, reason: 'gas' });
    expect(await (await GET(req('cUSD'))).json()).toEqual({ ok: false, reason: 'gas' });
    expect(checkSpendReadiness).toHaveBeenCalledTimes(2);
  });
});

// The token set and the wallet being asked about are both per-chain now.
describe('per-chain readiness', () => {
  it('asks about the chain in the query string', async () => {
    const GET = await load();
    await GET(req('USDC', 8453));
    expect(checkSpendReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: 8453, tokenSymbol: 'USDC' }),
    );
  });

  it('400s a token that does not exist on the requested chain', async () => {
    // cUSD is real, just not on Base.
    const GET = await load();
    const res = await GET(req('cUSD', 8453));
    expect(res.status).toBe(400);
    expect(checkSpendReadiness).not.toHaveBeenCalled();
  });

  // Serving one chain's readiness for another would gate the wrong wallet.
  it('caches per chain, not just per token', async () => {
    const GET = await load();
    await GET(req('USDC', 8453));
    await GET(req('USDC', CELO));
    expect(checkSpendReadiness).toHaveBeenCalledTimes(2);
  });

  it('falls back to the default chain when chainId is absent or unsupported', async () => {
    const GET = await load();
    const url = new URL('http://localhost/api/preflight');
    url.searchParams.set('token', 'USDC');
    await GET(new Request(url));
    expect(checkSpendReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: DEFAULT_CHAIN_ID }),
    );

    vi.clearAllMocks();
    checkSpendReadiness.mockResolvedValue({ ok: true });
    const GET2 = await load();
    await GET2(req('USDC', 1)); // Ethereum mainnet — not supported
    expect(checkSpendReadiness).toHaveBeenCalledWith(
      expect.objectContaining({ chainId: DEFAULT_CHAIN_ID }),
    );
  });
});
