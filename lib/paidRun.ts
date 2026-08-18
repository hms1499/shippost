// The one thing the client must not forget: that money already left the wallet.
//
// localStorage, not sessionStorage: an Android back gesture can tear down the
// whole MiniPay webview, and sessionStorage dies with it — which is precisely
// the failure this exists to survive. The cost is owning the lifetime by hand,
// hence the TTL and the explicit clears.

const KEY = 'coinop.paidRun.v1';

/** A run older than this is the history page's problem, not a resume. */
export const PAID_RUN_TTL_MS = 30 * 60 * 1000;

export interface PaidRun {
  v: 1;
  chainId: number;
  /** bigint as a decimal string — JSON has no bigint. */
  threadId: string;
  payTxHash: string;
  mode: 0 | 1 | 2 | 3 | 4 | 5;
  tokenSymbol: string;
  /** lowercased */
  wallet: string;
  startedAt: number;
}

function isPaidRun(v: unknown): v is PaidRun {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    r.v === 1 &&
    typeof r.chainId === 'number' &&
    typeof r.threadId === 'string' &&
    r.threadId.length > 0 &&
    typeof r.payTxHash === 'string' &&
    typeof r.mode === 'number' &&
    typeof r.tokenSymbol === 'string' &&
    typeof r.wallet === 'string' &&
    typeof r.startedAt === 'number'
  );
}

export function savePaidRun(run: PaidRun): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...run, wallet: run.wallet.toLowerCase() }));
  } catch {
    // Storage blocked. The run still completes on screen; only recovery is lost.
  }
}

export function loadPaidRun(): PaidRun | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage unreadable is the same as absent — never a crash.
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (isPaidRun(parsed)) return parsed;
  } catch {
    // fall through and sweep
  }

  // Unparseable, or written by a shape we no longer understand. Sweep it here:
  // the caller cannot tell this apart from "nothing saved", so if this function
  // does not clean up after itself, nothing ever will and the junk outlives
  // every other rejection path.
  clearPaidRun();
  return null;
}

export function clearPaidRun(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Pure predicate, so the rules are testable without a browser. A run belongs to
 * one wallet on one chain: resuming someone else's payment, or a payment made on
 * a chain the user has since left, would show them a thread they did not buy.
 */
export function isResumable(
  run: PaidRun,
  ctx: { now: number; wallet: string; chainId: number },
): boolean {
  if (run.v !== 1) return false;
  if (ctx.now - run.startedAt > PAID_RUN_TTL_MS) return false;
  if (run.wallet.toLowerCase() !== ctx.wallet.toLowerCase()) return false;
  if (run.chainId !== ctx.chainId) return false;
  return true;
}
