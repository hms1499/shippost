import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkPreviewAllowed = vi.fn();
const runPreview = vi.fn();

// Override only the gate; keep the real getClientIp (pure header parsing) so the
// IP-wiring test exercises the actual extraction.
vi.mock('@/lib/rateLimit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rateLimit')>();
  return { ...actual, checkPreviewAllowed };
});
vi.mock('@/lib/pipeline/runPreview', () => ({ runPreview }));

const { POST } = await import('./route');

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkPreviewAllowed.mockResolvedValue({ allowed: true });
});

describe('POST /api/preview', () => {
  it('returns 200 { available: false } when the gate denies', async () => {
    checkPreviewAllowed.mockResolvedValue({ allowed: false, reason: 'unavailable' });
    const res = await POST(req({ mode: 0, walletAddress: '0xabc', topic: 't', audience: 'beginner' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
    expect(runPreview).not.toHaveBeenCalled();
  });

  it('returns only firstTweet + totalTweets (never the full thread)', async () => {
    runPreview.mockResolvedValue({ tweets: ['1/ hook', '2/ secret', '3/ secret'] });
    const res = await POST(req({ mode: 0, walletAddress: '0xabc', topic: 't', audience: 'beginner' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ firstTweet: '1/ hook', totalTweets: 3 });
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('400 on missing walletAddress', async () => {
    const res = await POST(req({ mode: 0, topic: 't', audience: 'beginner' }));
    expect(res.status).toBe(400);
  });

  it('502 when generation throws', async () => {
    runPreview.mockRejectedValue(new Error('groq down'));
    const res = await POST(req({ mode: 0, walletAddress: '0xabc', topic: 't', audience: 'beginner' }));
    expect(res.status).toBe(502);
  });

  it('passes the client IP (from x-forwarded-for) to the gate', async () => {
    runPreview.mockResolvedValue({ tweets: ['1/ hook'] });
    await POST(
      req(
        { mode: 0, walletAddress: '0xabc', topic: 't', audience: 'beginner' },
        { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      ),
    );
    expect(checkPreviewAllowed).toHaveBeenCalledWith('0xabc', '203.0.113.7');
  });

  it('falls back to pay-first when the per-IP limit is hit', async () => {
    checkPreviewAllowed.mockResolvedValue({ allowed: false, reason: 'ip' });
    const res = await POST(req({ mode: 0, walletAddress: '0xabc', topic: 't', audience: 'beginner' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
    expect(runPreview).not.toHaveBeenCalled();
  });

  it('accepts mode 3 with no content fields (Daily Recap is input-free)', async () => {
    runPreview.mockResolvedValue({ tweets: ['1/ hook', '2/ body'] });
    const res = await POST(req({ mode: 3, walletAddress: '0xabc' }));
    expect(res.status).toBe(200);
    expect(runPreview).toHaveBeenCalledWith({ mode: 3 });
  });

  it('rejects an out-of-range mode', async () => {
    const res = await POST(req({ mode: 4, walletAddress: '0xabc' }));
    expect(res.status).toBe(400);
  });

  it('forwards eventContext into the mode-1 preview input', async () => {
    runPreview.mockResolvedValue({ tweets: ['1/ hook'] });
    const eventContext = { title: 'BTC ETF record', description: 'inflows', host: 'x.co', kind: 'news' };
    await POST(
      req({ mode: 1, walletAddress: '0xabc', eventDescription: 'https://x.co/a', angle: 'bullish', eventContext }),
    );
    expect(runPreview).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 1, eventContext }),
    );
  });
});
