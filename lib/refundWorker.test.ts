import { describe, it, expect, vi, beforeEach } from 'vitest';

const refundThread = vi.fn();
const getOnChainPaidAmount = vi.fn();
const alertOps = vi.fn().mockResolvedValue(undefined);

vi.mock('./agent/orchestrator', () => ({ refundThread, getOnChainPaidAmount }));
vi.mock('./tokens', () => ({ getTokens: () => ({ cUSD: { decimals: 18 } }) }));
vi.mock('./alert', () => ({ alertOps }));

const { processRefundRequest, computeAmount } = await import('./refundWorker');

/** Minimal stand-in for the Supabase query builder: chainable, thenable, and
 *  backed by a FIFO of scripted results so a test can say exactly what each
 *  round trip returns. Every write is recorded so the assertions can check what
 *  the worker actually persisted — which is the whole safety story here. */
function makeSupabase(results: unknown[]) {
  const writes: { table: string; payload: Record<string, unknown> }[] = [];
  const queue = [...results];
  const next = () => (queue.length ? queue.shift() : { data: null, error: null });

  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) {
      builder[m] = () => builder;
    }
    builder.update = (payload: Record<string, unknown>) => {
      writes.push({ table, payload });
      return builder;
    };
    builder.single = async () => next();
    // Awaiting the builder itself terminates a query too (an update with no
    // .select()), so it has to be thenable.
    builder.then = (res: (v: unknown) => unknown) => Promise.resolve(next()).then(res);
    return builder;
  };
  return { client: { from } as never, writes };
}

const REQUEST = {
  id: 7,
  chain_id: 42220,
  onchain_thread_id: '1000003',
  wallet_address: '0xUser',
  kind: 'full',
  status: 'pending',
};
const THREAD = { token_symbol: 'cUSD', refund_tx_hash: null, pay_tx_hash: '0xpay' };

beforeEach(() => {
  vi.clearAllMocks();
  getOnChainPaidAmount.mockResolvedValue(100000000000000000n); // 0.1 cUSD
  refundThread.mockResolvedValue('0xrefund');
});

describe('computeAmount', () => {
  const paidRaw = 100000000000000000n; // 0.1 @ 18dp

  it('full refunds the whole payment', () => {
    expect(computeAmount({ kind: 'full', paidRaw, decimals: 18 })).toBe('0.1');
  });

  it('slow-cancel refunds half', () => {
    expect(computeAmount({ kind: 'slow-cancel', paidRaw, decimals: 18 })).toBe('0.05');
  });

  it('REFUSES a partial with no amount — never guesses one', () => {
    expect(() => computeAmount({ kind: 'partial', paidRaw, decimals: 18 })).toThrow(/explicit amount/);
  });

  it('refuses a partial larger than what was paid', () => {
    expect(() => computeAmount({ kind: 'partial', paidRaw, decimals: 18, override: '0.2' })).toThrow(
      /over-refund/,
    );
  });

  it('refuses zero and non-numeric amounts', () => {
    expect(() => computeAmount({ kind: 'partial', paidRaw, decimals: 18, override: '0' })).toThrow();
    expect(() => computeAmount({ kind: 'partial', paidRaw, decimals: 18, override: 'abc' })).toThrow();
  });
});

describe('processRefundRequest', () => {
  it('sends, then stamps both the queue row and the thread', async () => {
    const { client, writes } = makeSupabase([
      { data: REQUEST, error: null },        // read request
      { data: THREAD, error: null },         // read thread
      { data: [{ id: 7 }], error: null },    // CAS lock won
      { data: null, error: null },           // mark completed
      { data: null, error: null },           // stamp thread
    ]);
    const out = await processRefundRequest({ supabase: client, requestId: 7 });

    expect(out).toEqual({ status: 'sent', txHash: '0xrefund', amountHuman: '0.1' });
    expect(refundThread).toHaveBeenCalledWith(expect.objectContaining({ amountHuman: '0.1', to: '0xUser' }));
    expect(writes.at(-2)?.payload).toMatchObject({ status: 'completed', refund_tx_hash: '0xrefund' });
    expect(writes.at(-1)).toMatchObject({ table: 'threads', payload: { refund_tx_hash: '0xrefund' } });
  });

  it('never sends twice: an already-stamped thread short-circuits', async () => {
    const { client, writes } = makeSupabase([
      { data: REQUEST, error: null },
      { data: { ...THREAD, refund_tx_hash: '0xearlier' }, error: null },
      { data: null, error: null },
    ]);
    const out = await processRefundRequest({ supabase: client, requestId: 7 });

    expect(out).toEqual({ status: 'already-refunded', txHash: '0xearlier' });
    expect(refundThread).not.toHaveBeenCalled();
    // The queue row is reconciled to the tx that already paid it out.
    expect(writes[0]).toMatchObject({ payload: { status: 'completed', refund_tx_hash: '0xearlier' } });
  });

  it('does not send for a row that is no longer pending', async () => {
    const { client } = makeSupabase([{ data: { ...REQUEST, status: 'processing' }, error: null }]);
    const out = await processRefundRequest({ supabase: client, requestId: 7 });
    expect(out).toEqual({ status: 'not-pending', actual: 'processing' });
    expect(refundThread).not.toHaveBeenCalled();
  });

  it('does not send when the compare-and-swap matched zero rows', async () => {
    // Supabase does not error on zero rows matched, so losing the race looks
    // exactly like success unless the returned rows are counted.
    const { client } = makeSupabase([
      { data: REQUEST, error: null },
      { data: THREAD, error: null },
      { data: [], error: null },
    ]);
    const out = await processRefundRequest({ supabase: client, requestId: 7 });
    expect(out).toEqual({ status: 'lost-lock' });
    expect(refundThread).not.toHaveBeenCalled();
  });

  it('leaves a failed send in processing — never back to pending', async () => {
    refundThread.mockRejectedValue(new Error('rpc timeout'));
    const { client, writes } = makeSupabase([
      { data: REQUEST, error: null },
      { data: THREAD, error: null },
      { data: [{ id: 7 }], error: null },
      { data: null, error: null },
    ]);
    await expect(processRefundRequest({ supabase: client, requestId: 7 })).rejects.toThrow('rpc timeout');

    // The transfer may have been broadcast before the throw, so reverting to
    // 'pending' would let a retry double-send.
    const statuses = writes.map((w) => w.payload.status);
    expect(statuses).not.toContain('pending');
    expect(writes.at(-1)?.payload.rejection_reason).toMatch(/on-chain state UNKNOWN/);
    expect(alertOps).toHaveBeenCalled();
  });
});
