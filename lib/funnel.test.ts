import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPayload, track, captureSource, __resetSessionIdForTests } from './funnel';

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

  it('includes source when present', () => {
    const p = buildPayload('sid-1', 'visit', { source: 'x' });
    expect(p).toEqual({ session_id: 'sid-1', stage: 'visit', source: 'x' });
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

describe('captureSource', () => {
  function stubStorage(initial: Record<string, string> = {}) {
    const store = { ...initial };
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    return store;
  }

  it('reads ?ref=x, whitelists it, and persists it', () => {
    vi.stubGlobal('window', { location: { search: '?ref=x' } });
    const store = stubStorage();
    expect(captureSource()).toBe('x');
    expect(store['coinop.funnel.source']).toBe('x');
  });

  it('ignores a non-whitelisted ?ref value', () => {
    vi.stubGlobal('window', { location: { search: '?ref=evil' } });
    stubStorage();
    expect(captureSource()).toBeNull();
  });

  it('is first-touch: a stored source is not overwritten by a new ?ref', () => {
    vi.stubGlobal('window', { location: { search: '?ref=x' } });
    stubStorage({ 'coinop.funnel.source': 'x' });
    // A later visit with no/other ref keeps the original.
    vi.stubGlobal('window', { location: { search: '' } });
    expect(captureSource()).toBe('x');
  });

  it('returns null (no throw) when there is no window', () => {
    vi.stubGlobal('window', undefined);
    expect(captureSource()).toBeNull();
  });
});

describe('track attaches the stored source', () => {
  beforeEach(() => { __resetSessionIdForTests(); });

  it('adds the stored source to every event body', async () => {
    const sendBeacon = vi.fn<(url: string, body?: BodyInit) => boolean>(() => true);
    const store: Record<string, string> = { 'coinop.funnel.source': 'x' };
    vi.stubGlobal('window', { navigator: { sendBeacon }, location: { search: '' } });
    vi.stubGlobal('navigator', { sendBeacon });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    vi.stubGlobal('crypto', { randomUUID: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });

    track('pay', { mode: 1 });

    const [, body] = sendBeacon.mock.calls[0];
    const parsed = JSON.parse(await (body as Blob).text());
    expect(parsed.source).toBe('x');
    expect(parsed.stage).toBe('pay');
  });
});
