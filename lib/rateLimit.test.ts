import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mock fns so the vi.mock factories (hoisted above imports) can close
// over them.
const { limitMock, redisCtor, slidingWindowMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  redisCtor: vi.fn(),
  slidingWindowMock: vi.fn((tokens: number, window: string) => ({ tokens, window })),
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor(opts: unknown) {
      redisCtor(opts);
    }
  },
}));

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    limit = limitMock;
    constructor(_opts: unknown) {}
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
