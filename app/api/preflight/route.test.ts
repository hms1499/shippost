import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const checkSpendReadiness = vi.fn();
vi.mock('@/lib/agent/walletHealth', () => ({ checkSpendReadiness }));

// Fresh module per test so the in-process cache never leaks between cases.
async function load() {
  vi.resetModules();
  return (await import('./route')).GET;
}

function req(token?: string): Request {
  const url = new URL('http://localhost/api/preflight');
  if (token !== undefined) url.searchParams.set('token', token);
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
