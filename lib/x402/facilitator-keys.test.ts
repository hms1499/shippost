import { describe, it, expect, vi } from 'vitest';
import type { FacilitatorClient } from '@x402/core/server';
import {
  RotatingKeyFacilitator,
  KeyPoolExhaustedError,
  parseFacilitatorKeys,
  parseKeyBudget,
  isKeyRefused,
} from './facilitator-keys';

// The two error shapes HTTPFacilitatorClient actually throws: a typed
// VerifyError/SettleError carrying statusCode when the body parses, and a bare
// Error with the status in the message when it does not.
function typedError(statusCode: number, errorReason?: string): Error {
  return Object.assign(new Error(errorReason ?? `status ${statusCode}`), { statusCode, errorReason });
}
function bareError(status: number, body: string): Error {
  return new Error(`Facilitator settle failed (${status}): ${body}`);
}

/** A facilitator that fails its first `failures` calls with `error`, then succeeds. */
function client(name: string, failures: number, error: () => Error): FacilitatorClient & { calls: number } {
  const c = {
    calls: 0,
    async verify() {
      c.calls += 1;
      if (c.calls <= failures) throw error();
      return { isValid: true, payer: name } as never;
    },
    async settle() {
      c.calls += 1;
      if (c.calls <= failures) throw error();
      return { success: true, transaction: name } as never;
    },
    async getSupported() {
      c.calls += 1;
      if (c.calls <= failures) throw error();
      return { kinds: [], extensions: [], signers: {} } as never;
    },
  };
  return c as FacilitatorClient & { calls: number };
}

describe('parseFacilitatorKeys', () => {
  it('reads a pool split on commas or whitespace', () => {
    expect(parseFacilitatorKeys({ X402_FACILITATOR_API_KEYS: 'a, b\nc  d' })).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('still accepts the singular key alone, so an existing deployment is unaffected', () => {
    expect(parseFacilitatorKeys({ X402_FACILITATOR_API_KEY: 'x402_live_abc' })).toEqual([
      'x402_live_abc',
    ]);
  });

  it('puts the singular key first when both are set', () => {
    const env = { X402_FACILITATOR_API_KEY: 'one', X402_FACILITATOR_API_KEYS: 'two,three' };
    expect(parseFacilitatorKeys(env)).toEqual(['one', 'two', 'three']);
  });

  it('drops duplicates — a key pasted twice would burn a rotation for nothing', () => {
    const env = { X402_FACILITATOR_API_KEY: 'one', X402_FACILITATOR_API_KEYS: 'one,two' };
    expect(parseFacilitatorKeys(env)).toEqual(['one', 'two']);
  });

  it('is empty when nothing is set', () => {
    expect(parseFacilitatorKeys({})).toEqual([]);
  });
});

describe('parseKeyBudget', () => {
  it('is undefined when unset — rotate only on refusal', () => {
    expect(parseKeyBudget({})).toBeUndefined();
  });
  it('reads a positive integer', () => {
    expect(parseKeyBudget({ X402_FACILITATOR_KEY_BUDGET: '500' })).toBe(500);
  });
  it('throws on nonsense rather than silently disabling the budget', () => {
    expect(() => parseKeyBudget({ X402_FACILITATOR_KEY_BUDGET: '0' })).toThrow(/positive integer/);
    expect(() => parseKeyBudget({ X402_FACILITATOR_KEY_BUDGET: 'lots' })).toThrow(
      /positive integer/,
    );
  });
});

describe('isKeyRefused', () => {
  it.each([401, 402, 403, 406])('treats %i as this key being finished', (status) => {
    expect(isKeyRefused(typedError(status))).toBe(true);
    expect(isKeyRefused(bareError(status, '{}'))).toBe(true);
  });

  it('reads the credit reason even when the status is not an auth code', () => {
    expect(isKeyRefused(typedError(400, 'insufficient_credits'))).toBe(true);
    expect(isKeyRefused(bareError(400, '{"error":"out of credits"}'))).toBe(true);
  });

  // Rotating on these would burn the whole pool against a problem that has
  // nothing to do with the keys.
  it('does not rotate on backpressure, outages or a bad payment', () => {
    expect(isKeyRefused(typedError(429, 'rate limited'))).toBe(false);
    expect(isKeyRefused(typedError(500, 'internal error'))).toBe(false);
    expect(isKeyRefused(typedError(400, 'insufficient_funds'))).toBe(false);
    expect(isKeyRefused(new Error('fetch failed'))).toBe(false);
    expect(isKeyRefused('not an error')).toBe(false);
  });
});

describe('RotatingKeyFacilitator', () => {
  it('stays on one key while it works', async () => {
    const a = client('a', 0, () => typedError(402));
    const b = client('b', 0, () => typedError(402));
    const pool = new RotatingKeyFacilitator([a, b]);

    for (let i = 0; i < 5; i++) await pool.settle({} as never, {} as never);

    expect(a.calls).toBe(5);
    expect(b.calls).toBe(0);
    expect(pool.status()).toMatchObject({ key: 0, total: 2, used: 5 });
  });

  it('retries the refused call on the next key, so the caller never sees the rotation', async () => {
    const a = client('a', 1, () => typedError(402, 'insufficient_credits'));
    const b = client('b', 0, () => typedError(402));
    const onRotate = vi.fn();
    const pool = new RotatingKeyFacilitator([a, b], { onRotate });

    const settled = (await pool.settle({} as never, {} as never)) as unknown as { transaction: string };

    expect(settled.transaction).toBe('b');
    expect(onRotate).toHaveBeenCalledWith(expect.stringContaining('switching to key 2'));
    expect(pool.status().key).toBe(1);
  });

  it('never returns to a retired key', async () => {
    const a = client('a', 1, () => typedError(402));
    const b = client('b', 0, () => typedError(402));
    const pool = new RotatingKeyFacilitator([a, b]);

    await pool.verify({} as never, {} as never);
    await pool.verify({} as never, {} as never);

    expect(a.calls).toBe(1);
    expect(b.calls).toBe(2);
  });

  it('surfaces one clear error once every key is spent, not a retry storm', async () => {
    const a = client('a', 99, () => typedError(402, 'insufficient_credits'));
    const b = client('b', 99, () => typedError(402, 'insufficient_credits'));
    const pool = new RotatingKeyFacilitator([a, b]);

    await expect(pool.settle({} as never, {} as never)).rejects.toBeInstanceOf(KeyPoolExhaustedError);
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);

    // A later call must not re-try the dead keys either.
    await expect(pool.settle({} as never, {} as never)).rejects.toThrow(/key pool exhausted/);
    expect(a.calls).toBe(1);
    expect(b.calls).toBe(1);
  });

  it('rethrows an error that is not the key being refused, without rotating', async () => {
    const a = client('a', 1, () => typedError(500, 'facilitator down'));
    const b = client('b', 0, () => typedError(402));
    const pool = new RotatingKeyFacilitator([a, b]);

    await expect(pool.settle({} as never, {} as never)).rejects.toThrow(/facilitator down/);
    expect(b.calls).toBe(0);
    expect(pool.status().key).toBe(0);
  });

  it('rotates on its own once a key has served its budget of settlements', async () => {
    const a = client('a', 0, () => typedError(402));
    const b = client('b', 0, () => typedError(402));
    const pool = new RotatingKeyFacilitator([a, b], { budget: 3 });

    for (let i = 0; i < 5; i++) await pool.settle({} as never, {} as never);

    expect(a.calls).toBe(3);
    expect(b.calls).toBe(2);
  });

  // Celo prices the facilitator at 1 credit = 1 settlement. Charging verifies
  // too would retire every key at half the capacity it actually has.
  it('does not charge the budget for verify or getSupported', async () => {
    const a = client('a', 0, () => typedError(402));
    const b = client('b', 0, () => typedError(402));
    const pool = new RotatingKeyFacilitator([a, b], { budget: 2 });

    for (let i = 0; i < 10; i++) await pool.verify({} as never, {} as never);
    await pool.getSupported();

    expect(pool.status()).toMatchObject({ key: 0, used: 0 });
    expect(b.calls).toBe(0);
  });

  // The budget is a guess about someone else's balance; spending the last key
  // on that guess would take the endpoint down while it could still serve.
  it('keeps serving on the last key past its budget', async () => {
    const only = client('only', 0, () => typedError(402));
    const pool = new RotatingKeyFacilitator([only], { budget: 2 });

    for (let i = 0; i < 4; i++) await pool.settle({} as never, {} as never);

    expect(only.calls).toBe(4);
  });

  it('retires a dead key once, not once per in-flight request', async () => {
    const a = client('a', 99, () => typedError(402, 'insufficient_credits'));
    const b = client('b', 0, () => typedError(402));
    const c = client('c', 0, () => typedError(402));
    const pool = new RotatingKeyFacilitator([a, b, c]);

    // Six concurrent calls all fail on key a. Without the index check they
    // would step over b and land on c.
    await Promise.all(Array.from({ length: 6 }, () => pool.settle({} as never, {} as never)));

    expect(pool.status().key).toBe(1);
    expect(b.calls).toBe(6);
    expect(c.calls).toBe(0);
  });

  it('refuses to be built without a key', () => {
    expect(() => new RotatingKeyFacilitator([])).toThrow(/at least one/);
  });
});
