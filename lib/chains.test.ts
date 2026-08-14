import { describe, it, expect } from 'vitest';
import { explorerBase, getChain } from './chains';

describe('explorerBase', () => {
  it('maps payment and settle chains to their explorers', () => {
    expect(explorerBase(42220)).toBe('https://celoscan.io');
    expect(explorerBase(8453)).toBe('https://basescan.org');
    expect(explorerBase(84532)).toBe('https://sepolia.basescan.org');
    expect(explorerBase(11142220)).toBe('https://celo-sepolia.blockscout.com');
    expect(explorerBase(undefined)).toBe('https://celo-sepolia.blockscout.com');
  });
});

describe('getChain', () => {
  it('resolves every chain the app can run on', () => {
    expect(getChain(8453).id).toBe(8453);
    expect(getChain(84532).id).toBe(84532);
    expect(getChain(42220).id).toBe(42220);
    expect(getChain(11142220).id).toBe(11142220);
  });

  // A chain we have no viem definition for must fail loudly rather than fall
  // through to a default and send a transaction to the wrong network.
  it('throws on a chain it does not know', () => {
    expect(() => getChain(1)).toThrow(/Unsupported chain/);
  });
});
