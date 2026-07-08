import { describe, it, expect } from 'vitest';
import { explorerBase } from './chains';

describe('explorerBase', () => {
  it('maps payment and settle chains to their explorers', () => {
    expect(explorerBase(42220)).toBe('https://celoscan.io');
    expect(explorerBase(8453)).toBe('https://basescan.org');
    expect(explorerBase(84532)).toBe('https://sepolia.basescan.org');
    expect(explorerBase(11142220)).toBe('https://celo-sepolia.blockscout.com');
    expect(explorerBase(undefined)).toBe('https://celo-sepolia.blockscout.com');
  });
});
