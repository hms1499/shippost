import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getMock, setMock, redisCtor } = vi.hoisted(() => ({
  getMock: vi.fn(),
  setMock: vi.fn(),
  redisCtor: vi.fn(),
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    get = getMock;
    set = setMock;
    constructor(opts: unknown) {
      redisCtor(opts);
    }
  },
}));

async function load() {
  vi.resetModules();
  return import('./previewCache');
}

const ORIG = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIG };
});
afterEach(() => {
  process.env = { ...ORIG };
});

function setUpstash() {
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
}

describe('normalizeGuestTopic', () => {
  it('trims, lowercases and collapses whitespace', async () => {
    const { normalizeGuestTopic } = await load();
    expect(normalizeGuestTopic('  ZK   Rollups ')).toBe('zk rollups');
  });
});

describe('guest preview cache', () => {
  it('returns null when Redis env is missing (fail-open)', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { getGuestPreviewCache } = await load();
    expect(await getGuestPreviewCache('zk rollups')).toBeNull();
    expect(redisCtor).not.toHaveBeenCalled();
  });

  it('returns a stored preview for the same normalised topic', async () => {
    setUpstash();
    getMock.mockResolvedValue({ firstTweet: '1/ hook', totalTweets: 4 });
    const { getGuestPreviewCache } = await load();
    expect(await getGuestPreviewCache('  ZK   Rollups ')).toEqual({
      firstTweet: '1/ hook',
      totalTweets: 4,
    });
    expect(getMock).toHaveBeenCalledWith('preview:guest:v1:zk rollups');
  });

  it('returns null on junk stored values', async () => {
    setUpstash();
    getMock.mockResolvedValue({ firstTweet: '   ', totalTweets: 2 });
    const { getGuestPreviewCache } = await load();
    expect(await getGuestPreviewCache('t')).toBeNull();
  });

  it('writes with a TTL and does not throw when Redis errors', async () => {
    setUpstash();
    setMock.mockRejectedValue(new Error('redis down'));
    const { setGuestPreviewCache } = await load();
    await expect(
      setGuestPreviewCache('zk rollups', { firstTweet: '1/ a', totalTweets: 3 }),
    ).resolves.toBeUndefined();
  });

  it('get returns null when Redis throws', async () => {
    setUpstash();
    getMock.mockRejectedValue(new Error('redis down'));
    const { getGuestPreviewCache } = await load();
    expect(await getGuestPreviewCache('t')).toBeNull();
  });
});
