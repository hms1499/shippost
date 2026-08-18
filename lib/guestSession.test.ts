import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { saveGuestTopic, peekGuestTopic, takeGuestTopic } from './guestSession';

const mem = new Map<string, string>();
const stub = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, v);
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
  clear: () => mem.clear(),
};

beforeEach(() => {
  mem.clear();
  vi.stubGlobal('sessionStorage', stub);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('guestSession', () => {
  it('saves and peeks a trimmed topic', () => {
    saveGuestTopic('  zk rollups  ');
    expect(peekGuestTopic()).toBe('zk rollups');
  });

  it('take reads once and clears', () => {
    saveGuestTopic('eip-712');
    expect(takeGuestTopic()).toBe('eip-712');
    expect(peekGuestTopic()).toBeNull();
    expect(takeGuestTopic()).toBeNull();
  });

  it('ignores empty saves', () => {
    saveGuestTopic('   ');
    expect(peekGuestTopic()).toBeNull();
  });
});
