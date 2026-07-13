import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkPreviewAlive } from './previewHealth';

const BASE = 'https://app.test';

function mockFetch(body: unknown, status = 200) {
  const f = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('checkPreviewAlive', () => {
  it('is healthy when the guest preview returns a real tweet', async () => {
    mockFetch({ firstTweet: '1/ gm', totalTweets: 5 });
    expect(await checkPreviewAlive(BASE)).toEqual({ ok: true });
  });

  // The bug this exists for: a fail-closed gate answers {available:false} with
  // HTTP 200 — a valid-looking response — so nothing else ever notices.
  it('is UNHEALTHY when the gate denies with {available:false} + HTTP 200', async () => {
    mockFetch({ available: false });
    const res = await checkPreviewAlive(BASE);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/gate denied/i);
  });

  it('is unhealthy on a non-2xx response', async () => {
    mockFetch({ error: 'boom' }, 502);
    const res = await checkPreviewAlive(BASE);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/502/);
  });

  it('is unhealthy when the response carries no tweet', async () => {
    mockFetch({ firstTweet: '   ' });
    expect((await checkPreviewAlive(BASE)).ok).toBe(false);
  });

  it('is unhealthy when the request throws (app unreachable)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const res = await checkPreviewAlive(BASE);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/ECONNREFUSED/);
  });

  // It must exercise the guest path — the landing's real conversion path, and
  // the one with no wallet to fall back on.
  it('probes the guest landing path: POST /api/preview, mode 0, no wallet', async () => {
    const f = mockFetch({ firstTweet: '1/ gm' });
    await checkPreviewAlive(BASE);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://app.test/api/preview');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body));
    expect(body.mode).toBe(0);
    expect(body.walletAddress).toBeUndefined();
    expect(typeof body.topic).toBe('string');
  });
});
