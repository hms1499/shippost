import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPayload, track, __resetSessionIdForTests } from './funnel';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildPayload', () => {
  it('includes session id + stage and only known optional fields', () => {
    const p = buildPayload('sid-1', 'pay', { mode: 1, chainId: 42220, wallet: '0xAbC' });
    expect(p).toEqual({
      session_id: 'sid-1',
      stage: 'pay',
      mode: 1,
      chain_id: 42220,
      wallet_address: '0xabc', // lowercased
    });
  });

  it('omits absent optional fields (no nulls for missing data)', () => {
    expect(buildPayload('sid-1', 'connect')).toEqual({
      session_id: 'sid-1',
      stage: 'connect',
    });
  });
});

describe('track', () => {
  beforeEach(() => {
    __resetSessionIdForTests();
  });

  it('is a no-op on the server (no window)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => track('connect')).not.toThrow();
  });

  it('sends via sendBeacon when available', () => {
    const sendBeacon = vi.fn<(url: string, body?: BodyInit) => boolean>(() => true);
    const store: Record<string, string> = {};
    vi.stubGlobal('window', { navigator: { sendBeacon } });
    vi.stubGlobal('navigator', { sendBeacon });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    vi.stubGlobal('crypto', { randomUUID: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });

    track('mode_select', { mode: 0 });

    expect(sendBeacon).toHaveBeenCalledOnce();
    const [url, body] = sendBeacon.mock.calls[0];
    expect(url).toBe('/api/public/funnel');
    expect(body).toBeInstanceOf(Blob);
  });

  it('falls back to fetch(keepalive) when sendBeacon is missing', () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => Promise.resolve(new Response(null, { status: 202 })));
    const store: Record<string, string> = {};
    vi.stubGlobal('window', { navigator: {} });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    vi.stubGlobal('crypto', { randomUUID: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });

    track('submit', { mode: 2 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/public/funnel');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('never throws if the transport errors', () => {
    vi.stubGlobal('window', { navigator: {} });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', () => { throw new Error('network'); });
    const store: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    vi.stubGlobal('crypto', { randomUUID: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });

    expect(() => track('share')).not.toThrow();
  });
});
