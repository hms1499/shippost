import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkPreviewAllowed = vi.fn();
const runPreview = vi.fn();

vi.mock('@/lib/rateLimit', () => ({ checkPreviewAllowed }));
vi.mock('@/lib/pipeline/runPreview', () => ({ runPreview }));

const { POST } = await import('./route');

function req(body: unknown): Request {
  return new Request('http://localhost/api/preview', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
});
