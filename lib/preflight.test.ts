import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchSpendReadiness } from './preflight';

function mockFetch(impl: () => Promise<unknown> | never) {
  vi.stubGlobal('fetch', vi.fn(impl));
}

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchSpendReadiness', () => {
  it('passes a ready answer through', async () => {
    mockFetch(() => jsonResponse({ ok: true }));
    expect(await fetchSpendReadiness('cUSD', 42220)).toEqual({ ok: true });
  });

  it('passes each blocking reason through', async () => {
    for (const reason of ['paused', 'gas', 'cap'] as const) {
      mockFetch(() => jsonResponse({ ok: false, reason }));
      expect(await fetchSpendReadiness('USDT', 42220)).toEqual({ ok: false, reason });
    }
  });

  // The chain has to travel with the token: the route falls back to the default
  // chain without it, and would answer about a wallet the user is not paying
  // from.
  it('encodes the token and the chain into the query', async () => {
    const spy = vi.fn(() => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', spy);
    await fetchSpendReadiness('USDC', 42220);
    expect(spy).toHaveBeenCalledWith(
      '/api/preflight?token=USDC&chainId=42220',
      expect.anything(),
    );
  });

  it('fails open when the request throws', async () => {
    mockFetch(() => {
      throw new Error('offline');
    });
    expect(await fetchSpendReadiness('cUSD', 42220)).toEqual({ ok: true });
  });

  it('fails open on a non-2xx response', async () => {
    mockFetch(() => jsonResponse({ error: 'bad token' }, 400));
    expect(await fetchSpendReadiness('cUSD', 42220)).toEqual({ ok: true });
  });

  it('fails open on a malformed body', async () => {
    mockFetch(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('not json')) }),
    );
    expect(await fetchSpendReadiness('cUSD', 42220)).toEqual({ ok: true });
  });

  it('fails open on an unrecognised reason rather than stranding the user', async () => {
    // A server-side shape change must never leave users stuck on a blocked
    // screen with no way to pay.
    mockFetch(() => jsonResponse({ ok: false, reason: 'something-new' }));
    expect(await fetchSpendReadiness('cUSD', 42220)).toEqual({ ok: true });
  });

  it('fails open when ok is missing entirely', async () => {
    mockFetch(() => jsonResponse({}));
    expect(await fetchSpendReadiness('cUSD', 42220)).toEqual({ ok: true });
  });
});
