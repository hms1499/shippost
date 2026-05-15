import { describe, it, expect, vi } from 'vitest';
import { retryOnce } from './retry';

describe('retryOnce', () => {
  it('returns the first result when fn succeeds', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(retryOnce(fn, { delayMs: 0 })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once and succeeds on the second attempt', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');
    await expect(retryOnce(fn, { delayMs: 0 })).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws the second error when both attempts fail', async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'));
    await expect(retryOnce(fn, { delayMs: 0 })).rejects.toThrow('second');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
