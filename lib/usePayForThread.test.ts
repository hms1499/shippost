import { describe, it, expect } from 'vitest';
import { resolveBundleTxHash } from './usePayForThread';

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
