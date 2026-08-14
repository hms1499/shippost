import { describe, it, expect } from 'vitest';
import { buildPayCalls } from './payBundle';

const token = {
  symbol: 'USDC' as const,
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const,
  decimals: 6,
  displayName: 'USD Coin',
};
const paymentAddr = '0x0dea32414e884253b51a43b19a6a8c6b8f3b1800' as const;

describe('buildPayCalls', () => {
  it('batches approve then pay when allowance is short', () => {
    const calls = buildPayCalls({
      token,
      paymentAddr,
      price: 100_000n,
      mode: 1,
      needsApprove: true,
      approveBatch: 40n,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0].functionName).toBe('approve');
    expect(calls[0].to).toBe(token.address);
    expect(calls[0].args).toEqual([paymentAddr, 4_000_000n]);
    expect(calls[1].functionName).toBe('payForThread');
    expect(calls[1].to).toBe(paymentAddr);
  });

  it('omits the approve when allowance already covers the price', () => {
    const calls = buildPayCalls({
      token,
      paymentAddr,
      price: 100_000n,
      mode: 1,
      needsApprove: false,
      approveBatch: 40n,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].functionName).toBe('payForThread');
  });

  // The ceiling is the user's consent. It must be exactly the price they were
  // shown — never padded, or the padding is headroom for an unnoticed increase.
  it('sets maxAmount to exactly the price that was read', () => {
    const calls = buildPayCalls({
      token,
      paymentAddr,
      price: 100_000n,
      mode: 1,
      needsApprove: false,
      approveBatch: 40n,
    });

    expect(calls[0].args).toEqual([token.address, 1, 100_000n]);
  });

  // The approve is a batch (many threads per signature) but the ceiling is not:
  // approving 40 threads' worth must never raise what a single pay can take.
  it('keeps the batched approve separate from the per-thread ceiling', () => {
    const calls = buildPayCalls({
      token,
      paymentAddr,
      price: 100_000n,
      mode: 0,
      needsApprove: true,
      approveBatch: 40n,
    });

    expect(calls[0].args[1]).toBe(4_000_000n);
    expect(calls[1].args[2]).toBe(100_000n);
  });

  it('approve always targets the payment contract as spender', () => {
    const calls = buildPayCalls({
      token,
      paymentAddr,
      price: 100_000n,
      mode: 0,
      needsApprove: true,
      approveBatch: 1n,
    });

    expect(calls[0].args[0]).toBe(paymentAddr);
  });

  // payForThread must be last: the caller takes the final receipt as the pay
  // transaction, which is what emits ThreadRequested.
  it('puts payForThread last in the bundle', () => {
    const calls = buildPayCalls({
      token,
      paymentAddr,
      price: 100_000n,
      mode: 3,
      needsApprove: true,
      approveBatch: 40n,
    });

    expect(calls[calls.length - 1].functionName).toBe('payForThread');
  });
});
