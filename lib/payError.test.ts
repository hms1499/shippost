import { describe, it, expect } from 'vitest';
import { describePayError } from './payError';

describe('describePayError', () => {
  it('prefers viem shortMessage over the verbose message', () => {
    const e = Object.assign(new Error('a very long viem dump\nwith stack detail'), {
      shortMessage: 'User rejected the request.',
    });
    expect(describePayError(e)).toContain('User rejected the request.');
    expect(describePayError(e)).not.toContain('with stack detail');
  });

  it('falls back to the plain Error message', () => {
    expect(describePayError(new Error('boom'))).toBe('boom');
  });

  it('keeps the error name when it adds information', () => {
    const e = Object.assign(new Error('boom'), { name: 'UserRejectedRequestError' });
    expect(describePayError(e)).toBe('boom [UserRejectedRequestError]');
  });

  it('drops the generic Error name', () => {
    expect(describePayError(new Error('boom'))).not.toContain('[Error]');
  });

  it('surfaces the EIP-1193 code, including from the cause', () => {
    const e = Object.assign(new Error('rejected'), {
      name: 'TransactionExecutionError',
      cause: { code: 4001, message: 'User denied transaction signature' },
    });
    const out = describePayError(e);
    expect(out).toContain('code=4001');
  });

  it('appends provider details when present', () => {
    const e = Object.assign(new Error('failed'), {
      shortMessage: 'An unknown RPC error occurred.',
      details: 'minipay: no active user gesture',
    });
    expect(describePayError(e)).toContain('minipay: no active user gesture');
  });

  it('never repeats details that already appear in the message', () => {
    const e = Object.assign(new Error('no active gesture'), {
      details: 'no active gesture',
    });
    expect(describePayError(e)).toBe('no active gesture');
  });

  it('handles non-Error throws', () => {
    expect(describePayError('just a string')).toBe('just a string');
    expect(describePayError(undefined)).toBe('Payment failed (unknown error)');
    expect(describePayError(null)).toBe('Payment failed (unknown error)');
  });

  it('stays short enough to read on a phone', () => {
    const e = Object.assign(new Error('x'.repeat(2000)), { details: 'y'.repeat(2000) });
    expect(describePayError(e).length).toBeLessThanOrEqual(300);
  });
});
