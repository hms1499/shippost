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
    expect(await fetchSpendReadiness('cUSD')).toEqual({ ok: true });
  });

  it('passes each blocking reason through', async () => {
    for (const reason of ['paused', 'gas', 'cap'] as const) {
      mockFetch(() => jsonResponse({ ok: false, reason }));
      expect(await fetchSpendReadiness('USDT')).toEqual({ ok: false, reason });
    }
  });

  it('encodes the token into the query', async () => {
    const spy = vi.fn(() => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', spy);
    await fetchSpendReadiness('USDC');
    expect(spy).toHaveBeenCalledWith('/api/preflight?token=USDC', expect.anything());
  });

  it('fails open when the request throws', async () => {
    mockFetch(() => {
      throw new Error('offline');
    });
    expect(await fetchSpendReadiness('cUSD')).toEqual({ ok: true });
  });

  it('fails open on a non-2xx response', async () => {
    mockFetch(() => jsonResponse({ error: 'bad token' }, 400));
    expect(await fetchSpendReadiness('cUSD')).toEqual({ ok: true });
  });

  it('fails open on a malformed body', async () => {
    mockFetch(() =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('not json')) }),
    );
    expect(await fetchSpendReadiness('cUSD')).toEqual({ ok: true });
  });

  it('fails open on an unrecognised reason rather than stranding the user', async () => {
    // A server-side shape change must never leave users stuck on a blocked
    // screen with no way to pay.
    mockFetch(() => jsonResponse({ ok: false, reason: 'something-new' }));
    expect(await fetchSpendReadiness('cUSD')).toEqual({ ok: true });
  });

  it('fails open when ok is missing entirely', async () => {
    mockFetch(() => jsonResponse({}));
    expect(await fetchSpendReadiness('cUSD')).toEqual({ ok: true });
  });
});
