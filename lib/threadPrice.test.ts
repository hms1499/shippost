import { describe, it, expect, vi } from 'vitest';
import { readThreadPrice } from './threadPrice';

describe('readThreadPrice', () => {
  const token = {
    symbol: 'USDC',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    displayName: 'USD Coin',
  } as any;

  it('returns requiredAmount from the contract', async () => {
    const readContract = vi.fn().mockResolvedValue(100_000n);

    const price = await readThreadPrice({
      publicClient: { readContract } as any,
      chainId: 42220,
      token,
    });

    expect(price).toBe(100_000n);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'requiredAmount', args: [token.address] }),
    );
  });

  // The on-chain price is authoritative; a local constant only ever drifts.
  it('does not fall back to the local constant when the read fails', async () => {
    const readContract = vi.fn().mockRejectedValue(new Error('rpc down'));

    await expect(
      readThreadPrice({ publicClient: { readContract } as any, chainId: 42220, token }),
    ).rejects.toThrow(/rpc down/);
  });

  // A price of 0 would mean a free thread, which the contract forbids
  // (setPrice rejects zero). Reading one back means we are talking to the wrong
  // address or a chain with no contract, and signing against it is worse than
  // failing.
  it('rejects a zero price rather than approving a free thread', async () => {
    const readContract = vi.fn().mockResolvedValue(0n);

    await expect(
      readThreadPrice({ publicClient: { readContract } as any, chainId: 42220, token }),
    ).rejects.toThrow(/price/i);
  });

  it('reads from the payment contract for the given chain', async () => {
    const readContract = vi.fn().mockResolvedValue(100_000n);

    await readThreadPrice({ publicClient: { readContract } as any, chainId: 42220, token });

    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: '0x0dea32414e884253b51a43b19a6a8c6b8f3b1800' }),
    );
  });
});
