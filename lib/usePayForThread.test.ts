import { describe, it, expect } from 'vitest';
import { resolveBundleTxHash, tokenChainMismatch } from './usePayForThread';
import { base, celo } from 'wagmi/chains';
import { BASE_MAINNET_TOKENS, CELO_MAINNET_TOKENS } from './tokens';

// sendCalls returns a BUNDLE ID, not a transaction hash. /api/generate/stream
// verifies payTxHash against an on-chain receipt, so posting the bundle id
// would fail verification for every sponsored payment.
describe('resolveBundleTxHash', () => {
  it('extracts the transaction hash from the settled bundle', () => {
    expect(
      resolveBundleTxHash({
        status: 'success',
        receipts: [{ transactionHash: '0xfeed', status: 'success' }],
      } as any),
    ).toBe('0xfeed');
  });

  it('takes the last receipt — payForThread is the final call in the bundle', () => {
    expect(
      resolveBundleTxHash({
        status: 'success',
        receipts: [
          { transactionHash: '0xapprove', status: 'success' },
          { transactionHash: '0xpay', status: 'success' },
        ],
      } as any),
    ).toBe('0xpay');
  });

  it('throws when the bundle produced no receipts', () => {
    expect(() => resolveBundleTxHash({ status: 'success', receipts: [] } as any)).toThrow(
      /no receipt/i,
    );
  });

  it('throws when receipts is absent entirely', () => {
    expect(() => resolveBundleTxHash({ status: 'success' } as any)).toThrow(/no receipt/i);
  });

  it('throws when the bundle did not succeed', () => {
    expect(() => resolveBundleTxHash({ status: 'failure', receipts: [] } as any)).toThrow(
      /bundle/i,
    );
  });

  it('throws while the bundle is still pending', () => {
    expect(() => resolveBundleTxHash({ status: 'pending', receipts: [] } as any)).toThrow(
      /bundle/i,
    );
  });

  // A bundle can report success while the call inside it reverted. Returning
  // that hash would tell /api/generate/stream a payment landed when no money
  // moved — free content on a reverted pay.
  it('throws when the pay call itself reverted', () => {
    expect(() =>
      resolveBundleTxHash({
        status: 'success',
        receipts: [
          { transactionHash: '0xapprove', status: 'success' },
          { transactionHash: '0xpay', status: 'reverted' },
        ],
      } as any),
    ).toThrow(/revert/i);
  });
});

describe('tokenChainMismatch', () => {
  it('accepts a token that belongs to the chain', () => {
    expect(tokenChainMismatch(base.id, BASE_MAINNET_TOKENS.USDC!)).toBeNull();
  });

  it('rejects a token from another chain', () => {
    const msg = tokenChainMismatch(base.id, CELO_MAINNET_TOKENS.cUSD);
    expect(msg).toContain('cUSD');
    expect(msg).toContain('Base');
  });

  it('rejects USDC from the wrong chain even though the symbol exists on both', () => {
    // The trap this guard exists for: same symbol, different address.
    const msg = tokenChainMismatch(base.id, CELO_MAINNET_TOKENS.USDC);
    expect(msg).not.toBeNull();
  });

  it('is case-insensitive about the address', () => {
    const lower = {
      ...BASE_MAINNET_TOKENS.USDC!,
      address: BASE_MAINNET_TOKENS.USDC!.address.toLowerCase() as `0x${string}`,
    };
    expect(tokenChainMismatch(base.id, lower)).toBeNull();
  });

  it('rejects rather than throwing on an unsupported chain', () => {
    expect(tokenChainMismatch(1, CELO_MAINNET_TOKENS.cUSD)).not.toBeNull();
  });

  it('accepts a Celo token on Celo', () => {
    expect(tokenChainMismatch(celo.id, CELO_MAINNET_TOKENS.USDT)).toBeNull();
  });
});
