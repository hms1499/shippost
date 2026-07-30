import { describe, it, expect, vi, afterEach } from 'vitest';
import { writeClipboard } from './useCopy';

afterEach(() => vi.unstubAllGlobals());

describe('writeClipboard', () => {
  it('writes the text and reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(writeClipboard('tweet one')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('tweet one');
  });

  it('reports failure when the webview rejects the write', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    await expect(writeClipboard('tweet one')).resolves.toBe(false);
  });

  it('reports failure when the Clipboard API is absent', async () => {
    vi.stubGlobal('navigator', {});
    await expect(writeClipboard('tweet one')).resolves.toBe(false);
  });

  it('is SSR-safe (no navigator)', async () => {
    vi.stubGlobal('navigator', undefined);
    await expect(writeClipboard('tweet one')).resolves.toBe(false);
  });
});
