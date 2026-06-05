import { describe, it, expect, vi, afterEach } from 'vitest';
import { matchesDesktop } from './useIsDesktop';

afterEach(() => vi.unstubAllGlobals());

describe('matchesDesktop', () => {
  it('returns false during SSR (no window)', () => {
    vi.stubGlobal('window', undefined);
    expect(matchesDesktop()).toBe(false);
  });

  it('returns false when matchMedia is unavailable', () => {
    vi.stubGlobal('window', {});
    expect(matchesDesktop()).toBe(false);
  });

  it('returns true when the min-width query matches', () => {
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q === '(min-width: 1024px)' }),
    });
    expect(matchesDesktop()).toBe(true);
  });

  it('returns false when the query does not match', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(matchesDesktop()).toBe(false);
  });
});
