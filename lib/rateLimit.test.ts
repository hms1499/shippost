import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mock fns so the vi.mock factories (hoisted above imports) can close
// over them.
const { limitMock, redisCtor, slidingWindowMock, ratelimitCtor, setMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  redisCtor: vi.fn(),
  slidingWindowMock: vi.fn((tokens: number, window: string) => ({ tokens, window })),
  ratelimitCtor: vi.fn(),
  setMock: vi.fn(),
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    set = setMock;
    constructor(opts: unknown) {
      redisCtor(opts);
    }
  },
}));

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    limit = limitMock;
    constructor(opts: unknown) {
      ratelimitCtor(opts);
    }
    static slidingWindow = slidingWindowMock;
  },
}));

// rateLimit.ts memoizes the Redis client + limiters at module scope, so each
// test needs a fresh module instance to exercise env-dependent construction.
async function load() {
  vi.resetModules();
  return import('./rateLimit');
}

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

function setUpstashEnv() {
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
}

function clearUpstashEnv() {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

describe('checkRateLimit', () => {
  it('allows when under the limit (env configured)', async () => {
    setUpstashEnv();
    limitMock.mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 123 });
    const { checkRateLimit } = await load();

    const res = await checkRateLimit('1.2.3.4', 'url-preview');

    expect(res.success).toBe(true);
    expect(redisCtor).toHaveBeenCalledTimes(1);
    expect(slidingWindowMock).toHaveBeenCalledWith(10, '60 s');
    expect(limitMock).toHaveBeenCalledWith('1.2.3.4');
    expect(ratelimitCtor).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: 'ratelimit:url-preview' }),
    );
  });

  it('denies when over the limit', async () => {
    setUpstashEnv();
    limitMock.mockResolvedValue({ success: false, limit: 5, remaining: 0, reset: 999 });
    const { checkRateLimit } = await load();

    const res = await checkRateLimit('1.2.3.4', 'refund-request');

    expect(res.success).toBe(false);
    expect(slidingWindowMock).toHaveBeenCalledWith(5, '60 s');
  });

  it('fails open and never touches Redis when env is missing', async () => {
    clearUpstashEnv();
    const { checkRateLimit } = await load();

    const res = await checkRateLimit('1.2.3.4', 'url-preview');

    expect(res.success).toBe(true);
    expect(redisCtor).not.toHaveBeenCalled();
    expect(limitMock).not.toHaveBeenCalled();
  });

  it('fails open when the limiter throws', async () => {
    setUpstashEnv();
    limitMock.mockRejectedValue(new Error('upstash down'));
    const { checkRateLimit } = await load();

    const res = await checkRateLimit('1.2.3.4', 'url-preview');

    expect(res.success).toBe(true);
  });
});

describe('checkPreviewAllowed', () => {
  it('fails CLOSED (unavailable) when Upstash env is missing', async () => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc', '1.2.3.4')).toEqual({ allowed: false, reason: 'unavailable' });
  });

  it('allows when per-wallet, per-IP and global all pass', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    limitMock.mockResolvedValue({ success: true, limit: 3, remaining: 2, reset: 0 });
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc', '1.2.3.4')).toEqual({ allowed: true });
  });

  it('blocks with reason "rate" when the per-wallet limit is exhausted', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    limitMock.mockResolvedValueOnce({ success: false, limit: 3, remaining: 0, reset: 0 });
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc', '1.2.3.4')).toEqual({ allowed: false, reason: 'rate' });
  });

  it('blocks with reason "ip" when the per-IP limit is hit (wallet ok)', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    limitMock
      .mockResolvedValueOnce({ success: true, limit: 3, remaining: 1, reset: 0 }) // wallet
      .mockResolvedValueOnce({ success: false, limit: 10, remaining: 0, reset: 0 }); // ip
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc', '1.2.3.4')).toEqual({ allowed: false, reason: 'ip' });
  });

  it('does not consume the global budget when the per-IP limit blocks', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    limitMock
      .mockResolvedValueOnce({ success: true, limit: 3, remaining: 1, reset: 0 }) // wallet
      .mockResolvedValueOnce({ success: false, limit: 10, remaining: 0, reset: 0 }); // ip
    const { checkPreviewAllowed } = await load();
    await checkPreviewAllowed('0xabc', '1.2.3.4');
    // wallet + ip only — global (the 3rd) is never called.
    expect(limitMock).toHaveBeenCalledTimes(2);
  });

  it('blocks with reason "global" when the daily cap is hit (wallet + IP ok)', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    limitMock
      .mockResolvedValueOnce({ success: true, limit: 3, remaining: 1, reset: 0 }) // wallet
      .mockResolvedValueOnce({ success: true, limit: 10, remaining: 9, reset: 0 }) // ip
      .mockResolvedValueOnce({ success: false, limit: 500, remaining: 0, reset: 0 }); // global
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc', '1.2.3.4')).toEqual({ allowed: false, reason: 'global' });
  });

  it('fails CLOSED when the limiter throws', async () => {
    process.env.UPSTASH_REDIS_REST_URL = 'https://x';
    process.env.UPSTASH_REDIS_REST_TOKEN = 't';
    limitMock.mockRejectedValue(new Error('redis down'));
    const { checkPreviewAllowed } = await load();
    expect(await checkPreviewAllowed('0xabc', '1.2.3.4')).toEqual({ allowed: false, reason: 'unavailable' });
  });
});

describe('claimGenerationOnce', () => {
  it('returns "unavailable" and never touches Redis when env is missing', async () => {
    clearUpstashEnv();
    const { claimGenerationOnce } = await load();

    expect(await claimGenerationOnce('42220:0xabc')).toBe('unavailable');
    expect(redisCtor).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  it('claims the key the first time (SET NX returns OK)', async () => {
    setUpstashEnv();
    setMock.mockResolvedValue('OK');
    const { claimGenerationOnce } = await load();

    expect(await claimGenerationOnce('42220:0xabc')).toBe('claimed');
    expect(setMock).toHaveBeenCalledWith(
      'generate:claim:42220:0xabc',
      '1',
      { nx: true, ex: 3600 },
    );
  });

  it('reports a replay when the key already exists (SET NX returns null)', async () => {
    setUpstashEnv();
    setMock.mockResolvedValue(null);
    const { claimGenerationOnce } = await load();

    expect(await claimGenerationOnce('42220:0xabc')).toBe('replay');
  });

  it('fails open ("unavailable") when Redis throws', async () => {
    setUpstashEnv();
    setMock.mockRejectedValue(new Error('upstash down'));
    const { claimGenerationOnce } = await load();

    expect(await claimGenerationOnce('42220:0xabc')).toBe('unavailable');
  });
});

describe('getClientIp', () => {
  it('returns the first IP from x-forwarded-for', async () => {
    const { getClientIp } = await load();
    const req = new Request('https://x', {
      headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
    });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  it('falls back to "unknown" when the header is absent', async () => {
    const { getClientIp } = await load();
    const req = new Request('https://x');
    expect(getClientIp(req)).toBe('unknown');
  });
});
