import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkPreviewAllowed = vi.fn();
const checkPreviewGuestBurst = vi.fn();
const checkPreviewGuestBudget = vi.fn();
const getGuestPreviewCache = vi.fn();
const setGuestPreviewCache = vi.fn();
const runPreview = vi.fn();

// Override only the gates; keep the real getClientIp (pure header parsing) so the
// IP-wiring test exercises the actual extraction.
vi.mock('@/lib/rateLimit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/rateLimit')>();
  return {
    ...actual,
    checkPreviewAllowed,
    checkPreviewGuestBurst,
    checkPreviewGuestBudget,
  };
});
vi.mock('@/lib/previewCache', () => ({ getGuestPreviewCache, setGuestPreviewCache }));
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
  checkPreviewGuestBurst.mockResolvedValue({ allowed: true });
  checkPreviewGuestBudget.mockResolvedValue({ allowed: true });
  getGuestPreviewCache.mockResolvedValue(null);
  setGuestPreviewCache.mockResolvedValue(undefined);
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

  it('allows a guest (no wallet) mode-0 taste via the guest gate', async () => {
    runPreview.mockResolvedValue({ tweets: ['1/ hook', '2/ body'] });
    const res = await POST(
      req({ mode: 0, topic: 't', audience: 'beginner' }, { 'x-forwarded-for': '203.0.113.7' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ firstTweet: '1/ hook', totalTweets: 2 });
    expect(checkPreviewGuestBurst).toHaveBeenCalledWith('203.0.113.7');
    expect(checkPreviewGuestBudget).toHaveBeenCalledWith('203.0.113.7');
    expect(checkPreviewAllowed).not.toHaveBeenCalled();
    expect(runPreview).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 0, topic: 't', skipGrounding: true }),
    );
    expect(setGuestPreviewCache).toHaveBeenCalledWith('t', { firstTweet: '1/ hook', totalTweets: 2 });
  });

  it('returns a cached guest preview without generating or spending daily budget', async () => {
    getGuestPreviewCache.mockResolvedValue({ firstTweet: '1/ cached', totalTweets: 5 });
    const res = await POST(req({ mode: 0, topic: 'zk rollups' }, { 'x-forwarded-for': '203.0.113.7' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ firstTweet: '1/ cached', totalTweets: 5 });
    expect(checkPreviewGuestBurst).toHaveBeenCalledOnce();
    expect(checkPreviewGuestBudget).not.toHaveBeenCalled();
    expect(runPreview).not.toHaveBeenCalled();
  });

  it('rejects a guest (no wallet) for any non-Educational mode', async () => {
    const res = await POST(req({ mode: 3 }));
    expect(res.status).toBe(400);
    expect(runPreview).not.toHaveBeenCalled();
    expect(checkPreviewGuestBurst).not.toHaveBeenCalled();
  });

  it('falls back to pay-first when the guest gate denies', async () => {
    checkPreviewGuestBurst.mockResolvedValue({ allowed: false, reason: 'ip' });
    const res = await POST(req({ mode: 0, topic: 't', audience: 'beginner' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: false });
    expect(runPreview).not.toHaveBeenCalled();
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
    const res = await POST(req({ mode: 6, walletAddress: '0xabc' }));
    expect(res.status).toBe(400);
  });

  it('accepts mode 4 (Chain Comparison) with a connected wallet and topic pair', async () => {
    runPreview.mockResolvedValue({ tweets: ['1/ hook', '2/ body'] });
    const res = await POST(req({ mode: 4, walletAddress: '0xabc', topic: 'solana|base' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ firstTweet: '1/ hook', totalTweets: 2 });
    expect(runPreview).toHaveBeenCalledWith({ mode: 4, topic: 'solana|base' });
  });

  it('rejects mode 4 without a topic', async () => {
    const res = await POST(req({ mode: 4, walletAddress: '0xabc' }));
    expect(res.status).toBe(400);
    expect(runPreview).not.toHaveBeenCalled();
  });

  it('rejects a guest (no wallet) for mode 4', async () => {
    const res = await POST(req({ mode: 4, topic: 'solana|base' }));
    expect(res.status).toBe(400);
    expect(runPreview).not.toHaveBeenCalled();
    expect(checkPreviewGuestBurst).not.toHaveBeenCalled();
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

  it('accepts mode 5 (News Breakdown) and forwards eventContext', async () => {
    runPreview.mockResolvedValue({ tweets: ['1/ hook', '2/ body'] });
    const eventContext = { title: 'BTC ETF record', description: 'inflows', host: 'x.co', kind: 'news' };
    const res = await POST(
      req({ mode: 5, walletAddress: '0xabc', eventDescription: 'https://x.co/a', eventContext }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ firstTweet: '1/ hook', totalTweets: 2 });
    expect(runPreview).toHaveBeenCalledWith({
      mode: 5,
      eventDescription: 'https://x.co/a',
      eventContext,
    });
  });

  it('rejects mode 5 without an eventDescription', async () => {
    const res = await POST(req({ mode: 5, walletAddress: '0xabc' }));
    expect(res.status).toBe(400);
    expect(runPreview).not.toHaveBeenCalled();
  });

  it('rejects a guest (no wallet) for mode 5', async () => {
    const res = await POST(req({ mode: 5, eventDescription: 'Celo upgrades to L2' }));
    expect(res.status).toBe(400);
    expect(runPreview).not.toHaveBeenCalled();
    expect(checkPreviewGuestBurst).not.toHaveBeenCalled();
  });
});
