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
  stage: 'select' | 'enqueue' | 'flip';
  message: string;
}

export interface ReconcileResult {
  swept: number; // threads flipped pending → failed
  enqueued: number; // slow-cancel refund_requests upserted
  errors: ReconcileError[];
}

export async function reconcileStuckThreads(
  supabase: SupabaseClient,
  opts: ReconcileOptions = {},
): Promise<ReconcileResult> {
  const thresholdMs = opts.thresholdMs ?? DEFAULT_THRESHOLD_MS;
  const now = opts.now ?? Date.now();
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const cutoff = new Date(now - thresholdMs).toISOString();

  const result: ReconcileResult = { swept: 0, enqueued: 0, errors: [] };

  const { data, error } = await supabase
    .from('threads')
    .select('chain_id, onchain_thread_id, wallet_address')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .limit(limit);

  if (error) {
    result.errors.push({ stage: 'select', message: error.message });
    return result;
  }

  const rows = (data ?? []) as Array<{
    chain_id: number;
    onchain_thread_id: string;
    wallet_address: string;
  }>;

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

  return result;
}
