import type { SupabaseClient } from '@supabase/supabase-js';

// Recovery for the worst state in the system (ARCHITECTURE §3.4): a thread stuck
// in status='pending' — paid for, never delivered, never refunded — because the
// pipeline died outside the reach of its own 150s deadline (hard crash, SIGKILL,
// or a DB write that failed after spend). This sweeper turns that invisible
// stuck state into a visible, queued refund. It NEVER sends money: it enqueues a
// slow-cancel request into the proven-safe refund_requests queue (CAS lock,
// on-chain amount, refund_tx_hash guard live in the worker) and flips the thread
// to 'failed'. Draining the queue stays a separate, human-gated step.

// Well past PIPELINE_DEADLINE_MS (150s) + the 90s settle bound, so a still-'pending'
// row this old is guaranteed dead — no risk of refunding an in-flight run.
const DEFAULT_THRESHOLD_MS = 15 * 60_000;
const DEFAULT_LIMIT = 100;

export interface ReconcileOptions {
  thresholdMs?: number;
  now?: number;
  limit?: number;
}

export interface ReconcileError {
  threadId?: string;
  stage: 'select' | 'enqueue' | 'flip' | 'select-failed' | 'enqueue-failed';
  message: string;
}

export interface ReconcileResult {
  swept: number; // threads flipped pending → failed
  enqueued: number; // slow-cancel refund_requests upserted
  enqueuedFailed: number; // full refund_requests upserted for delivered-nothing runs
  errors: ReconcileError[];
}

interface StuckRow {
  chain_id: number;
  onchain_thread_id: string;
  wallet_address: string;
}

export async function reconcileStuckThreads(
  supabase: SupabaseClient,
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const thresholdMs = opts.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const cutoff = new Date(now - thresholdMs).toISOString();

  const result: ReconcileResult = { swept: 0, enqueued: 0, enqueuedFailed: 0, errors: [] };

  const { data, error } = await supabase
    .from('threads')
    .select('chain_id, onchain_thread_id, wallet_address')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(limit);

  if (error) {
    result.errors.push({ stage: 'select', message: error.message });
    // The failed-run pass below is independent of this query, so a dead
    // 'pending' select must not also cancel the refunds it would have queued.
    await enqueueFailedRuns(supabase, cutoff, limit, result);
    return result;
  }

  const rows = (data ?? []) as StuckRow[];

  for (const r of rows) {
    // Enqueue FIRST (idempotent upsert). If the flip below crashes, the row
    // stays 'pending' and the next run re-enqueues (a no-op) and retries the
    // flip — so a 'failed' row always has its refund_request, never the reverse.
    const { error: upErr } = await supabase.from('refund_requests').upsert(
      {
        chain_id: r.chain_id,
        onchain_thread_id: r.onchain_thread_id,
        wallet_address: r.wallet_address,
        kind: 'slow-cancel',
      },
      { onConflict: 'chain_id,onchain_thread_id,wallet_address,kind', ignoreDuplicates: false },
    );
    if (upErr) {
      result.errors.push({ threadId: r.onchain_thread_id, stage: 'enqueue', message: upErr.message });
      continue; // do not flip a row we couldn't queue a refund for
    }
    result.enqueued++;

    // CAS flip: only touch the row if it is still 'pending', so we never race a
    // run that completed between the select and now.
    const { error: flipErr } = await supabase
      .from('threads')
      .update({ status: 'failed' })
      .eq('chain_id', r.chain_id)
      .eq('onchain_thread_id', r.onchain_thread_id)
      .eq('status', 'pending');
    if (flipErr) {
      result.errors.push({ threadId: r.onchain_thread_id, stage: 'flip', message: flipErr.message });
      continue;
    }
    result.swept++;
  }

  await enqueueFailedRuns(supabase, cutoff, limit, result);

  return result;
}

// The other half of "paid, never delivered, never refunded".
//
// The sweep above only ever sees status='pending' — a run that died silently.
// A run that failed *loudly* is written status='failed' by the route's own catch
// (app/api/generate/stream/route.ts), which that query can never match. So until
// this pass existed, the only thing that queued a refund for a failed run was the
// user tapping "Request refund now"; anyone who read the UI's "a refund will be
// sent automatically" and closed the app was never refunded at all.
//
// Two conditions keep this honest and cheap:
//   tweets IS NULL          — a failed run that still produced tweets is a
//                             PARTIAL delivery. Refunding it in full would pay
//                             the user back for content they received, so it
//                             stays a user-initiated 'partial' request.
//   refund_tx_hash IS NULL  — already paid out. That column is the single source
//                             of truth for payouts (CLAUDE.md); never re-send.
//
// Nothing is flipped here: the row is already in its terminal state. And unlike
// the pending path there is no CAS to make this idempotent, so an existing
// request is looked up first — otherwise every daily run would re-upsert the
// same rows and page ops about work it had already done.
async function enqueueFailedRuns(
  supabase: SupabaseClient,
  cutoff: string,
  limit: number,
  result: ReconcileResult,
): Promise<void> {
  const { data, error } = await supabase
    .from('threads')
    .select('chain_id, onchain_thread_id, wallet_address')
    .eq('status', 'failed')
    .is('tweets', null)
    .is('refund_tx_hash', null)
    .lt('created_at', cutoff)
    .limit(limit);

  if (error) {
    result.errors.push({ stage: 'select-failed', message: error.message });
    return;
  }

  const rows = (data ?? []) as StuckRow[];
  if (rows.length === 0) return;

  const { data: existing, error: exErr } = await supabase
    .from('refund_requests')
    .select('chain_id, onchain_thread_id')
    .in(
      'onchain_thread_id',
      rows.map((r) => r.onchain_thread_id),
    );

  if (exErr) {
    // Enqueueing blind would be safe for the user's money (the upsert is
    // idempotent per kind, and the worker still guards on refund_tx_hash) but it
    // would re-page ops every night. Skip the pass and try again tomorrow.
    result.errors.push({ stage: 'select-failed', message: exErr.message });
    return;
  }

  // Keyed on chain AND thread id: Base and Celo number threads independently,
  // so thread #7 on one chain must not suppress thread #7 on the other.
  const already = new Set(
    ((existing ?? []) as Array<{ chain_id: number; onchain_thread_id: string }>).map(
      (r) => `${r.chain_id}:${r.onchain_thread_id}`,
    ),
  );

  for (const r of rows) {
    if (already.has(`${r.chain_id}:${r.onchain_thread_id}`)) continue;

    // 'full' — nothing was delivered. Same kind the user's own button sends, so
    // if they tap after this ran, the upsert returns this row instead of
    // queueing a second refund for one payment.
    const { error: upErr } = await supabase.from('refund_requests').upsert(
      {
        chain_id: r.chain_id,
        onchain_thread_id: r.onchain_thread_id,
        wallet_address: r.wallet_address,
        kind: 'full',
      },
      { onConflict: 'chain_id,onchain_thread_id,wallet_address,kind', ignoreDuplicates: false },
    );
    if (upErr) {
      result.errors.push({
        threadId: r.onchain_thread_id,
        stage: 'enqueue-failed',
        message: upErr.message,
      });
      continue;
    }
    result.enqueuedFailed++;
  }
}
