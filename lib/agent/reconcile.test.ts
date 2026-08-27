import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reconcileStuckThreads } from './reconcile';

interface Row {
  chain_id: number;
  onchain_thread_id: string;
  wallet_address: string;
}

interface Query {
  table: string;
  filters: Record<string, unknown>;
  limit?: number;
}

/**
 * Hand-rolled Supabase mock. The builder is generic (every filter method
 * records and returns itself, awaiting resolves) because reconcile now runs
 * three different shapes against `threads` / `refund_requests`:
 *   status='pending' + created_at<cutoff                  → stuck rows
 *   status in (failed,completed) + tweets IS NULL + refund_tx_hash IS NULL
 *                                                         → delivered-nothing rows
 *   refund_requests.in(onchain_thread_id, …)              → dedupe
 * `resolve` picks the answer per recorded query, so a test only describes the
 * rows it cares about.
 */
function makeDb(opts: {
  rows?: Row[];
  failedRows?: Row[];
  existingRequests?: Array<{ chain_id: number; onchain_thread_id: string }>;
  selectError?: string;
  failedSelectError?: string;
  requestsSelectError?: string;
  upsertErrorFor?: string; // onchain_thread_id whose enqueue fails
  flipErrorFor?: string; // onchain_thread_id whose flip fails
}) {
  const log: string[] = [];
  const upserts: Array<{ payload: Record<string, unknown>; opts: unknown }> = [];
  const flips: Array<Record<string, string | number>> = [];
  const queries: Query[] = [];

  function resolve(q: Query): { data: unknown; error: { message: string } | null } {
    if (q.table === 'refund_requests') {
      return opts.requestsSelectError
        ? { data: null, error: { message: opts.requestsSelectError } }
        : { data: opts.existingRequests ?? [], error: null };
    }
    // enqueueFailedRuns now filters both terminal states via .in(), so the
    // recorded value is an array rather than the old bare 'failed'.
    if (q.filters.status === 'failed' || Array.isArray(q.filters.status)) {
      return opts.failedSelectError
        ? { data: null, error: { message: opts.failedSelectError } }
        : { data: opts.failedRows ?? [], error: null };
    }
    return opts.selectError
      ? { data: null, error: { message: opts.selectError } }
      : { data: opts.rows ?? [], error: null };
  }

  function selectBuilder(table: string) {
    const q: Query = { table, filters: {} };
    queries.push(q);
    const chain = {
      eq(col: string, val: unknown) {
        q.filters[col] = val;
        return chain;
      },
      is(col: string, val: unknown) {
        q.filters[col] = val;
        return chain;
      },
      in(col: string, val: unknown) {
        q.filters[col] = val;
        return chain;
      },
      lt(col: string, val: unknown) {
        q.filters[col] = val;
        return chain;
      },
      limit(n: number) {
        q.limit = n;
        return Promise.resolve(resolve(q));
      },
      then(cb: (v: { data: unknown; error: { message: string } | null }) => void) {
        cb(resolve(q));
      },
    };
    return chain;
  }

  const client = {
    from(table: string) {
      if (table === 'threads') {
        return {
          select: () => selectBuilder(table),
          update: (_patch: Record<string, unknown>) => {
            const eqs: Record<string, string | number> = {};
            const chain = {
              eq(col: string, val: string | number) {
                eqs[col] = val;
                return chain;
              },
              then(resolve2: (v: { error: { message: string } | null }) => void) {
                log.push('flip');
                flips.push(eqs);
                const fail = opts.flipErrorFor && eqs.onchain_thread_id === opts.flipErrorFor;
                resolve2({ error: fail ? { message: 'flip failed' } : null });
              },
            };
            return chain;
          },
        };
      }
      // refund_requests
      return {
        select: () => selectBuilder(table),
        upsert(payload: Record<string, unknown>, upsertOpts: unknown) {
          log.push('enqueue');
          upserts.push({ payload, opts: upsertOpts });
          const fail = opts.upsertErrorFor && payload.onchain_thread_id === opts.upsertErrorFor;
          return Promise.resolve({ error: fail ? { message: 'upsert failed' } : null });
        },
      };
    },
  };

  return {
    client: client as unknown as SupabaseClient,
    log,
    upserts,
    flips,
    queries,
    query(pred: (q: Query) => boolean) {
      return queries.find(pred);
    },
  };
}

const NOW = Date.parse('2026-07-06T12:00:00.000Z');

function row(id: string): Row {
  return { chain_id: 42220, onchain_thread_id: id, wallet_address: `0xwallet${id}` };
}

describe('reconcileStuckThreads — stuck (pending) runs', () => {
  it('enqueues a slow-cancel refund and flips each stuck thread to failed', async () => {
    const db = makeDb({ rows: [row('1'), row('2')] });
    const res = await reconcileStuckThreads(db.client, { now: NOW, thresholdMs: 900_000 });

    expect(res).toEqual({ swept: 2, enqueued: 2, enqueuedFailed: 0, errors: [] });
    expect(db.upserts).toHaveLength(2);
    expect(db.upserts[0].payload).toMatchObject({
      chain_id: 42220,
      onchain_thread_id: '1',
      wallet_address: '0xwallet1',
      kind: 'slow-cancel',
    });
    expect(db.upserts[0].opts).toMatchObject({
      onConflict: 'chain_id,onchain_thread_id,wallet_address,kind',
    });
    // CAS: the flip is guarded on status still being 'pending'.
    expect(db.flips[0]).toMatchObject({ onchain_thread_id: '1', status: 'pending' });
  });

  it('queries with the correct cutoff and limit', async () => {
    const db = makeDb({ rows: [] });
    await reconcileStuckThreads(db.client, { now: NOW, thresholdMs: 900_000, limit: 50 });
    const q = db.query((q) => q.filters.status === 'pending');
    expect(q?.filters.created_at).toBe(new Date(NOW - 900_000).toISOString());
    expect(q?.limit).toBe(50);
  });

  it('enqueues before flipping (so a crash never leaves failed-without-refund)', async () => {
    const db = makeDb({ rows: [row('1')] });
    await reconcileStuckThreads(db.client, { now: NOW });
    expect(db.log).toEqual(['enqueue', 'flip']);
  });

  it('does not flip a row whose enqueue failed, and keeps processing the batch', async () => {
    const db = makeDb({ rows: [row('1'), row('2')], upsertErrorFor: '1' });
    const res = await reconcileStuckThreads(db.client, { now: NOW });

    expect(res.swept).toBe(1); // only row 2 flipped
    expect(res.enqueued).toBe(1);
    expect(res.errors).toEqual([{ threadId: '1', stage: 'enqueue', message: 'upsert failed' }]);
    // row 1 never flipped; row 2 did
    expect(db.flips).toHaveLength(1);
    expect(db.flips[0]).toMatchObject({ onchain_thread_id: '2' });
  });

  it('records a flip error (enqueued but not swept) without aborting', async () => {
    const db = makeDb({ rows: [row('1'), row('2')], flipErrorFor: '1' });
    const res = await reconcileStuckThreads(db.client, { now: NOW });
    expect(res.enqueued).toBe(2);
    expect(res.swept).toBe(1);
    expect(res.errors).toEqual([{ threadId: '1', stage: 'flip', message: 'flip failed' }]);
  });

  it('returns a select-stage error and does nothing when the query fails', async () => {
    const db = makeDb({ selectError: 'db down' });
    const res = await reconcileStuckThreads(db.client, { now: NOW });
    expect(res.swept).toBe(0);
    expect(res.enqueued).toBe(0);
    expect(res.errors).toContainEqual({ stage: 'select', message: 'db down' });
    expect(db.upserts).toHaveLength(0);
  });
});

// A run that reached `fatal` is written status='failed' by /api/generate/stream,
// which the pending sweep above can never see. Until this pass existed, the ONLY
// thing that queued a refund for it was the user tapping the button — so the UI's
// "a refund is sent automatically" was false for every user who closed the app.
describe('reconcileStuckThreads — failed runs that delivered nothing', () => {
  it('enqueues a full refund for a failed run with no tweets', async () => {
    const db = makeDb({ failedRows: [row('7')] });
    const res = await reconcileStuckThreads(db.client, { now: NOW });

    expect(res.enqueuedFailed).toBe(1);
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].payload).toMatchObject({
      chain_id: 42220,
      onchain_thread_id: '7',
      wallet_address: '0xwallet7',
      kind: 'full',
    });
    // Never flipped: the row is already 'failed'.
    expect(db.flips).toHaveLength(0);
  });

  it('only selects terminal rows that delivered nothing and were never paid out', async () => {
    const db = makeDb({ failedRows: [] });
    await reconcileStuckThreads(db.client, { now: NOW, thresholdMs: 900_000 });

    const q = db.query((q) => Array.isArray(q.filters.status));
    expect(q).toBeDefined();
    // BOTH terminal states. interpretThreadRow (lib/resumeRun.ts) tells a user
    // whose row says 'completed' with nothing in it that the run is broken and
    // refundable; querying only 'failed' left that the one state the UI calls
    // refundable and nothing ever queued.
    expect(q?.filters.status).toEqual(['failed', 'completed']);
    // A run that still produced tweets is a PARTIAL delivery — refunding it in
    // full would pay for content the user received.
    expect(q?.filters.tweets).toBeNull();
    // Already paid out. `threads.refund_tx_hash` is the single source of truth.
    expect(q?.filters.refund_tx_hash).toBeNull();
    expect(q?.filters.created_at).toBe(new Date(NOW - 900_000).toISOString());
  });

  it('skips a thread that already has a refund request, so the daily alert stays quiet', async () => {
    const db = makeDb({
      failedRows: [row('7'), row('8')],
      existingRequests: [{ chain_id: 42220, onchain_thread_id: '7' }],
    });
    const res = await reconcileStuckThreads(db.client, { now: NOW });

    expect(res.enqueuedFailed).toBe(1);
    expect(db.upserts).toHaveLength(1);
    expect(db.upserts[0].payload).toMatchObject({ onchain_thread_id: '8' });
  });

  it('matches an existing request on chain AND thread id, not thread id alone', async () => {
    // Same onchain_thread_id, different chain: Base and Celo number threads
    // independently, so a Celo request must not suppress the Base refund.
    const db = makeDb({
      failedRows: [row('7')],
      existingRequests: [{ chain_id: 8453, onchain_thread_id: '7' }],
    });
    const res = await reconcileStuckThreads(db.client, { now: NOW });
    expect(res.enqueuedFailed).toBe(1);
  });

  it('records an enqueue error per thread and keeps going', async () => {
    const db = makeDb({ failedRows: [row('7'), row('8')], upsertErrorFor: '7' });
    const res = await reconcileStuckThreads(db.client, { now: NOW });

    expect(res.enqueuedFailed).toBe(1);
    expect(res.errors).toEqual([
      { threadId: '7', stage: 'enqueue-failed', message: 'upsert failed' },
    ]);
  });

  it('records a select error without touching the stuck-run result', async () => {
    const db = makeDb({ rows: [row('1')], failedSelectError: 'failed query down' });
    const res = await reconcileStuckThreads(db.client, { now: NOW });

    expect(res.swept).toBe(1); // the pending pass still succeeded
    expect(res.enqueuedFailed).toBe(0);
    expect(res.errors).toContainEqual({ stage: 'select-failed', message: 'failed query down' });
  });

  it('enqueues nothing when the dedupe lookup fails, rather than guessing', async () => {
    const db = makeDb({ failedRows: [row('7')], requestsSelectError: 'lookup down' });
    const res = await reconcileStuckThreads(db.client, { now: NOW });

    expect(res.enqueuedFailed).toBe(0);
    expect(db.upserts).toHaveLength(0);
    expect(res.errors).toContainEqual({ stage: 'select-failed', message: 'lookup down' });
  });

  it('does not query refund_requests at all when there are no failed rows', async () => {
    const db = makeDb({ failedRows: [] });
    await reconcileStuckThreads(db.client, { now: NOW });
    expect(db.query((q) => q.table === 'refund_requests')).toBeUndefined();
  });
});
