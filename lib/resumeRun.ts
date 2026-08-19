// What a thread row means to someone waiting for a run they already paid for.
// Kept pure and outside hooks/ so `vitest run lib app` actually collects it.

/** Fast enough to feel live, slow enough not to hammer the row. */
export const RESUME_POLL_MS = 3_000;
/** A healthy run is 20-40s. Past this the answer is /history, not a spinner. */
export const RESUME_CEILING_MS = 180_000;

export interface ThreadRow {
  status: string | null;
  tweets: string[] | null;
  topic: string | null;
  /** On-chain verified amount in token base units, as written at insert time. */
  amountPaidRaw: string | null;
  totalCostUsd: string | null;
  tokenSymbol: string | null;
  payTxHash: string | null;
}

export type ResumeState =
  | { state: 'checking' }
  | {
      state: 'done';
      tweets: string[];
      amountPaidRaw: string | null;
      totalCostUsd: string;
      topic: string | null;
    }
  // `delivered` separates the two failures that need different money answers: a
  // run that produced nothing is fully refundable, while one that failed after
  // writing tweets is a partial delivery — the nightly sweep deliberately skips
  // those (lib/agent/reconcile.ts), and the tweets are readable in /history.
  | { state: 'failed'; delivered: boolean }
  | { state: 'gone' };

export function interpretThreadRow(row: ThreadRow | null): ResumeState {
  // No row yet is not the same as no run. /api/generate/stream inserts the row
  // itself, so a client that died right after the payment landed can arrive
  // here before the row exists. Keep waiting; the caller's ceiling decides when
  // to give up.
  if (!row) return { state: 'checking' };

  if (row.status === 'failed') {
    return { state: 'failed', delivered: (row.tweets?.length ?? 0) > 0 };
  }

  if (row.status === 'completed') {
    // Completed with nothing to show is a broken run, not a delivery. Sending
    // the user to the refund copy is the honest branch.
    if (!row.tweets || row.tweets.length === 0) return { state: 'failed', delivered: false };
    return {
      state: 'done',
      tweets: row.tweets,
      // Never substituted. A receipt that cannot state the price says nothing
      // rather than reprinting today's price for yesterday's payment.
      amountPaidRaw: row.amountPaidRaw,
      // The row is the only record of what this run cost. Absent means unknown,
      // and '0.000' reads as unknown — it is never back-filled from a constant.
      totalCostUsd: row.totalCostUsd ?? '0.000',
      topic: row.topic,
    };
  }

  return { state: 'checking' };
}

/** null means "no answer yet" — a 404, an error status, or an offline device. */
export async function fetchThreadRow(
  chainId: number,
  threadId: string,
  wallet: string,
  signal?: AbortSignal,
): Promise<ThreadRow | null> {
  try {
    const res = await fetch(
      `/api/thread?chainId=${chainId}&threadId=${threadId}&wallet=${wallet.toLowerCase()}`,
      { signal },
    );
    if (!res.ok) return null;
    return (await res.json()) as ThreadRow;
  } catch {
    return null;
  }
}
