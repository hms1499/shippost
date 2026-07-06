import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchPreview, fetchGuestPreview } from './previewClient';

afterEach(() => vi.unstubAllGlobals());

const args = { mode: 0 as const, walletAddress: '0xabc', topic: 't', audience: 'beginner' as const };

describe('fetchPreview', () => {
  it('returns the preview on success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ firstTweet: 'hi', totalTweets: 4 }) })));
    expect(await fetchPreview(args)).toEqual({ firstTweet: 'hi', totalTweets: 4 });
  });

  it('returns null when the server reports unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ available: false }) })));
    expect(await fetchPreview(args)).toBeNull();
  });

  it('returns null on a non-ok (e.g. 502) response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: 'x' }) })));
    expect(await fetchPreview(args)).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    expect(await fetchPreview(args)).toBeNull();
  });
});

describe('fetchGuestPreview', () => {
  it('posts a wallet-less mode-0 body and returns the preview', async () => {
    let sentBody = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
      sentBody = String(init.body);
      return { ok: true, json: async () => ({ firstTweet: 'hi', totalTweets: 5 }) };
    }));
    expect(await fetchGuestPreview('zk rollups')).toEqual({ firstTweet: 'hi', totalTweets: 5 });
    const body = JSON.parse(sentBody);
    expect(body).toEqual({ mode: 0, topic: 'zk rollups', audience: 'beginner' });
    expect(body).not.toHaveProperty('walletAddress');
  });

  it('returns null on any failure (fail-soft to connect)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ available: false }) })));
    expect(await fetchGuestPreview('t')).toBeNull();
  });
});
