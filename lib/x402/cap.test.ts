import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const incrby = vi.fn();
const decrby = vi.fn();
const expire = vi.fn();
const get = vi.fn();

vi.mock('@upstash/redis', () => ({
  Redis: { fromEnv: () => ({ incrby, decrby, expire, get }) },
}));

const { reserveDailySpend, isPaused } = await import('./cap');

beforeEach(() => { vi.clearAllMocks(); expire.mockResolvedValue(1); });
afterEach(() => { vi.unstubAllEnvs(); });

describe('reserveDailySpend', () => {
  it('reserves and sets a TTL when under the cap', async () => {
    incrby.mockResolvedValue(1000); // new total = 0.001 USDC, cap = 5 USDC
    await expect(reserveDailySpend({
      caip2: 'eip155:8453', token: '0xusdc', amountRaw: 1000n, capRaw: 5_000_000n,
    })).resolves.toBeUndefined();
    expect(incrby).toHaveBeenCalledOnce();
    expect(expire).toHaveBeenCalledOnce();
    expect(decrby).not.toHaveBeenCalled();
  });

  it('rolls back and throws when the reservation would exceed the cap', async () => {
    incrby.mockResolvedValue(6_000_000); // over 5 USDC cap
    await expect(reserveDailySpend({
      caip2: 'eip155:8453', token: '0xusdc', amountRaw: 1000n, capRaw: 5_000_000n,
    })).rejects.toThrow('daily spend cap exceeded');
    expect(decrby).toHaveBeenCalledWith(expect.any(String), 1000);
  });

  it('keys the counter by chain so two chains do not share one budget', async () => {
    incrby.mockResolvedValue(1000);
    await reserveDailySpend({
      caip2: 'eip155:8453', token: '0xusdc', amountRaw: 1000n, capRaw: 5_000_000n,
    });
    await reserveDailySpend({
      caip2: 'eip155:42220', token: '0xusdc', amountRaw: 1000n, capRaw: 5_000_000n,
    });

    const keys = incrby.mock.calls.map((c) => c[0] as string);
    expect(keys[0]).toContain('eip155:8453');
    expect(keys[1]).toContain('eip155:42220');
    expect(keys[0]).not.toBe(keys[1]);
    expect(keys[0]).toMatch(/^x402:spend:\d{4}-\d{2}-\d{2}:eip155:8453:0xusdc$/);
  });
});

describe('isPaused', () => {
  it('is true when the env flag is set', async () => {
    vi.stubEnv('X402_PAUSED', 'true');
    expect(await isPaused()).toBe(true);
  });

  it('is true when the Redis pause key is 1', async () => {
    get.mockResolvedValue('1');
    expect(await isPaused()).toBe(true);
  });

  it('is false otherwise', async () => {
    get.mockResolvedValue(null);
    expect(await isPaused()).toBe(false);
  });
});
