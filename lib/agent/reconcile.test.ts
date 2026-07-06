import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { reconcileStuckThreads } from './reconcile';

interface Row {
  chain_id: number;
  onchain_thread_id: string;
  wallet_address: string;
}

/**
 * Hand-rolled Supabase mock covering exactly the three chains reconcile uses:
 *   from('threads').select().eq().lt().limit()          → select stuck rows
 *   from('refund_requests').upsert(payload, opts)        → enqueue
 *   from('threads').update().eq().eq().eq()              → CAS flip
 * A shared `log` records call order so tests can assert enqueue-before-flip.
 */
function makeDb(opts: {
  rows?: Row[];
  selectError?: string;
  upsertErrorFor?: string; // onchain_thread_id whose enqueue fails
  flipErrorFor?: string; // onchain_thread_id whose flip fails
}) {
  const log: string[] = [];
  const upserts: Array<{ payload: Record<string, unknown>; opts: unknown }> = [];
  const flips: Array<Record<string, string | number>> = [];
  let ltArg: string | undefined;
  let limitArg: number | undefined;

  const client = {
    from(table: string) {
      if (table === 'threads') {
        return {
          select: () => ({
            eq: () => ({
              lt: (_col: string, val: string) => {
                ltArg = val;
                return {
                  limit: (n: number) => {
                    limitArg = n;
                    return Promise.resolve(
                      opts.selectError
                        ? { data: null, error: { message: opts.selectError } }
                        : { data: opts.rows ?? [], error: null },
                    );
                  },
                };
              },
            }),
          }),
          update: (_patch: Record<string, unknown>) => {
            const eqs: Record<string, string | number> = {};
            const chain = {
              eq(col: string, val: string | number) {
                eqs[col] = val;
                return chain;
              },
              then(resolve: (v: { error: { message: string } | null }) => void) {
                log.push('flip');
                flips.push(eqs);
                const fail = opts.flipErrorFor && eqs.onchain_thread_id === opts.flipErrorFor;
                resolve({ error: fail ? { message: 'flip failed' } : null });
              },
            };
            return chain;
          },
        };
      }
      // refund_requests
      return {
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
    get ltArg() {
      return ltArg;
    },
    get limitArg() {
      return limitArg;
    },
  };
}

const NOW = Date.parse('2026-07-06T12:00:00.000Z');

function row(id: string): Row {
  return { chain_id: 42220, onchain_thread_id: id, wallet_address: `0xwallet${id}` };
}

describe('reconcileStuckThreads', () => {
  it('enqueues a slow-cancel refund and flips each stuck thread to failed', async () => {
    const db = makeDb({ rows: [row('1'), row('2')] });
    const res = await reconcileStuckThreads(db.client, { now: NOW, thresholdMs: 900_000 });

    expect(res).toEqual({ swept: 2, enqueued: 2, errors: [] });
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
    expect(db.ltArg).toBe(new Date(NOW - 900_000).toISOString());
    expect(db.limitArg).toBe(50);
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
    expect(res).toEqual({ swept: 0, enqueued: 0, errors: [{ stage: 'select', message: 'db down' }] });
    expect(db.upserts).toHaveLength(0);
  });
});
