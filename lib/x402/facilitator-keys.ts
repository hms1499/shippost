import type { FacilitatorClient } from '@x402/core/server';

/**
 * Facilitator API keys used one at a time, with failover when one is refused.
 *
 * The Celo hosted facilitator meters a finite credit balance against each API
 * key. When a key runs dry the facilitator stops answering `/verify` and
 * `/settle`, and every paid endpoint behind it goes down with it — that is
 * exactly how the rail died on 2026-08-05, and swapping the key meant a
 * redeploy. Holding several keys turns that outage into a rotation.
 *
 * Keys are consumed in order, never round-robin: spreading requests across the
 * pool would only make every key run out at the same moment.
 */

/** Thrown when the last key in the pool has been refused. */
export class KeyPoolExhaustedError extends Error {
  constructor(reasons: string[]) {
    super(`x402 facilitator key pool exhausted (${reasons.length} keys spent): ${reasons.join(' | ')}`);
    this.name = 'KeyPoolExhaustedError';
  }
}

/**
 * Reads the key pool from the environment.
 *
 * `X402_FACILITATOR_API_KEYS` holds the pool, separated by commas or newlines;
 * the singular `X402_FACILITATOR_API_KEY` still works and counts as a pool of
 * one, so an existing deployment behaves exactly as before. Setting both
 * concatenates them, singular first, because that is the reading in which an
 * unchanged deployment keeps using the key it already had.
 */
export function parseFacilitatorKeys(env: Record<string, string | undefined> = process.env): string[] {
  const raw = [env.X402_FACILITATOR_API_KEY, env.X402_FACILITATOR_API_KEYS].filter(Boolean).join(',');
  const keys = raw
    .split(/[\s,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  // A key pasted twice would be retired twice and burn a rotation for nothing.
  return [...new Set(keys)];
}

/**
 * Optional ceiling on how many *settlements* one key may serve before the pool
 * moves on by itself — Celo prices its facilitator at 1 credit = 1 settlement
 * (500 free), so settlements are the unit a key is metered in. Unset means
 * rotate only when the facilitator refuses a key, which is the safe default
 * since it needs no guess about anyone's balance.
 */
export function parseKeyBudget(env: Record<string, string | undefined> = process.env): number | undefined {
  const raw = env.X402_FACILITATOR_KEY_BUDGET;
  if (!raw) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`X402_FACILITATOR_KEY_BUDGET must be a positive integer (got "${raw}")`);
  }
  return n;
}

/**
 * Whether an error means *this key* is finished, as opposed to the facilitator
 * being down or the payment itself being bad.
 *
 * Deliberately narrow. Rotating on the wrong error would retry a settle that
 * the facilitator had already broadcast, and would burn the whole pool against
 * a facilitator outage that a plain retry would have ridden out. Credit and
 * auth rejections are refused before any transaction is signed, which is what
 * makes retrying them on the next key safe.
 */
export function isKeyRefused(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const status = (error as { statusCode?: number }).statusCode ?? statusFromMessage(error.message);
  // 429 is backpressure, not exhaustion, and 5xx is the facilitator's problem.
  const authStatus = status === 401 || status === 402 || status === 403 || status === 406;

  const text = [
    error.message,
    (error as { invalidReason?: string }).invalidReason,
    (error as { errorReason?: string }).errorReason,
    (error as { invalidMessage?: string }).invalidMessage,
    (error as { errorMessage?: string }).errorMessage,
  ]
    .filter(Boolean)
    .join(' ');

  return authStatus || /insufficient[\s_-]*credits|settlement credits|out of credits|credit balance|quota|invalid[\s_-]*api[\s_-]*key|unauthorized|forbidden/i.test(text);
}

// HTTPFacilitatorClient formats non-2xx bodies it cannot parse as
// `Facilitator verify failed (402): …`, with no statusCode on the error.
function statusFromMessage(message: string): number | undefined {
  const m = /\((\d{3})\)/.exec(message);
  return m ? Number(m[1]) : undefined;
}

export interface RotatingKeyFacilitatorOptions {
  /** Settlements one key may serve before the pool rotates on its own. */
  budget?: number;
  /** Called once per rotation, for the server log. */
  onRotate?: (message: string) => void;
}

/**
 * A facilitator client backed by one HTTP client per API key.
 *
 * One client per key rather than one client swapping headers: the index the
 * operation ran under is then the index it retires, so two concurrent failures
 * on the same key cannot skip a live key between them.
 */
export class RotatingKeyFacilitator implements FacilitatorClient {
  private index = 0;
  private used = 0;
  private readonly retired: string[] = [];

  constructor(
    private readonly clients: readonly FacilitatorClient[],
    private readonly opts: RotatingKeyFacilitatorOptions = {},
  ) {
    if (clients.length === 0) throw new Error('RotatingKeyFacilitator needs at least one facilitator client');
  }

  verify(...args: Parameters<FacilitatorClient['verify']>): ReturnType<FacilitatorClient['verify']> {
    return this.run('verify', false, (c) => c.verify(...args));
  }

  settle(...args: Parameters<FacilitatorClient['settle']>): ReturnType<FacilitatorClient['settle']> {
    return this.run('settle', true, (c) => c.settle(...args));
  }

  getSupported(): ReturnType<FacilitatorClient['getSupported']> {
    return this.run('getSupported', false, (c) => c.getSupported());
  }

  /** Keys spent, keys total, and settlements served by the key in use. */
  status(): { key: number; total: number; used: number; budget?: number } {
    return { key: this.index, total: this.clients.length, used: this.used, budget: this.opts.budget };
  }

  private async run<T>(
    op: string,
    metered: boolean,
    call: (client: FacilitatorClient) => Promise<T>,
  ): Promise<T> {
    // At most one attempt per key: a pool-wide failure must surface as one
    // clear error, not as a retry storm against a facilitator that is down.
    for (let attempt = 0; attempt < this.clients.length; attempt++) {
      const i = this.claim(metered);
      try {
        return await call(this.clients[i]);
      } catch (error) {
        if (!isKeyRefused(error)) throw error;
        this.retire(i, `${op}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`);
      }
    }
    throw new KeyPoolExhaustedError(this.retired);
  }

  /**
   * Picks the key for the next call, rotating first if it is at budget, and
   * charges it when the call is one the facilitator meters. Only settlement
   * spends a credit, so counting verifies too would retire every key at half
   * its real capacity.
   *
   * The last key is never retired on budget alone — the budget is a guess about
   * someone else's balance, and burning the final key on a guess would take the
   * endpoint down while it could still serve.
   */
  private claim(metered: boolean): number {
    const { budget } = this.opts;
    if (budget !== undefined && this.used >= budget && this.index < this.clients.length - 1) {
      this.retire(this.index, `budget of ${budget} settlements reached`);
    }
    if (this.index >= this.clients.length) throw new KeyPoolExhaustedError(this.retired);
    if (metered) this.used += 1;
    return this.index;
  }

  /**
   * Advances past key `i`, unless a concurrent failure already did. Without the
   * index check, six in-flight requests failing on the same dead key would step
   * over five live ones.
   */
  private retire(i: number, reason: string): void {
    if (i !== this.index) return;
    this.retired.push(`key ${i + 1}/${this.clients.length} — ${reason}`);
    this.index += 1;
    this.used = 0;
    const left = this.clients.length - this.index;
    this.opts.onRotate?.(
      left > 0
        ? `[x402] facilitator key ${i + 1}/${this.clients.length} retired (${reason}); switching to key ${this.index + 1}, ${left - 1} spare left`
        : `[x402] facilitator key ${i + 1}/${this.clients.length} retired (${reason}); no keys left`,
    );
  }
}
