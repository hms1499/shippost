import { describe, it, expect, vi, afterEach } from 'vitest';
import { setBodyScrollLocked } from './useBodyScrollLock';

afterEach(() => vi.unstubAllGlobals());

function stubBody() {
  const body = { style: { overflow: '' } };
  vi.stubGlobal('document', { body });
  return body;
}

describe('setBodyScrollLocked', () => {
  it('sets overflow hidden when locked', () => {
    const body = stubBody();
    setBodyScrollLocked(true);
    expect(body.style.overflow).toBe('hidden');
  });

  it('clears overflow when unlocked', () => {
    const body = stubBody();
    body.style.overflow = 'hidden';
    setBodyScrollLocked(false);
    expect(body.style.overflow).toBe('');
  });

  it('is a no-op during SSR (no document)', () => {
    vi.stubGlobal('document', undefined);
    expect(() => setBodyScrollLocked(true)).not.toThrow();
  });
});
