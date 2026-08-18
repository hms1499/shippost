import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  savePaidRun,
  loadPaidRun,
  clearPaidRun,
  isResumable,
  PAID_RUN_TTL_MS,
  type PaidRun,
} from './paidRun';

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

const RUN: PaidRun = {
  v: 1,
  chainId: 42220,
  threadId: '4182',
  payTxHash: '0x7f3a',
  mode: 0,
  tokenSymbol: 'cUSD',
  wallet: '0xabc',
  startedAt: 1_000_000,
};
const CTX = { now: 1_000_000, wallet: '0xabc', chainId: 42220 };

beforeEach(() => {
  mem.clear();
  vi.stubGlobal('localStorage', stub);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('paidRun storage', () => {
  it('round-trips a saved run', () => {
    savePaidRun(RUN);
    expect(loadPaidRun()).toEqual(RUN);
  });

  it('clear removes it', () => {
    savePaidRun(RUN);
    clearPaidRun();
    expect(loadPaidRun()).toBeNull();
  });

  it('returns null when nothing was saved', () => {
    expect(loadPaidRun()).toBeNull();
  });

  it('treats malformed JSON as absent', () => {
    mem.set('coinop.paidRun.v1', '{not json');
    expect(loadPaidRun()).toBeNull();
  });

  it('treats a record missing required fields as absent', () => {
    mem.set('coinop.paidRun.v1', JSON.stringify({ v: 1, chainId: 42220 }));
    expect(loadPaidRun()).toBeNull();
  });

  it('survives localStorage throwing on read and on write', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(() => savePaidRun(RUN)).not.toThrow();
    expect(loadPaidRun()).toBeNull();
    expect(() => clearPaidRun()).not.toThrow();
  });
});

describe('isResumable', () => {
  it('accepts a fresh run on the same wallet and chain', () => {
    expect(isResumable(RUN, CTX)).toBe(true);
  });

  it('accepts a run just inside the TTL', () => {
    expect(isResumable(RUN, { ...CTX, now: RUN.startedAt + PAID_RUN_TTL_MS - 1 })).toBe(true);
  });

  it('rejects a run past the TTL', () => {
    expect(isResumable(RUN, { ...CTX, now: RUN.startedAt + PAID_RUN_TTL_MS + 1 })).toBe(false);
  });

  it('rejects a run started in a different wallet', () => {
    expect(isResumable(RUN, { ...CTX, wallet: '0xdef' })).toBe(false);
  });

  it('compares wallets case-insensitively', () => {
    expect(isResumable(RUN, { ...CTX, wallet: '0xABC' })).toBe(true);
  });

  it('rejects a run started on a different chain', () => {
    expect(isResumable(RUN, { ...CTX, chainId: 8453 })).toBe(false);
  });

  it('rejects a record from a future schema version', () => {
    expect(isResumable({ ...RUN, v: 2 as unknown as 1 }, CTX)).toBe(false);
  });
});
