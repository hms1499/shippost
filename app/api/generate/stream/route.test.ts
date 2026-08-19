import { describe, it, expect, vi, beforeEach } from 'vitest';
import { celoSepolia } from '@/lib/chains';

// /api/generate/stream is the ONLY path that spends real cUSD, so its money
// invariants (CLAUDE.md "Generate-flow invariants") must be locked by tests,
// not just comments. We mock the four boundaries the route orchestrates —
// payment proof, DB, and the two pipelines — and assert the route's own
// behaviour: nothing paid runs before the on-chain proof, the replay guard
// fails closed, the *verified* amount (never the client's) is persisted, and a
// pipeline failure lands in a clean refundable state. getContracts stays real
// (pure address lookup with hardcoded fallbacks).
const verifyPayment = vi.fn();
const getSupabaseServer = vi.fn();
const runModeA = vi.fn();
const runModeB = vi.fn();
const MODE_A_TOTAL_COST_USD = '0.050';

// PaymentNotVerifiedError has to be the REAL class: the route narrows on
// `instanceof`, so a stand-in would silently take the "do not record" branch and
// the orphan-payment tests below would pass for the wrong reason.
vi.mock('@/lib/agent/orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/agent/orchestrator')>();
  return { verifyPayment, PaymentNotVerifiedError: actual.PaymentNotVerifiedError };
});
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));
vi.mock('@/lib/pipeline/runModeA', () => ({ runModeA, MODE_A_TOTAL_COST_USD }));
vi.mock('@/lib/pipeline/runModeB', () => ({ runModeB }));

// chainPolicy reads the allowlist from env at module load, and this suite pays
// on Celo Sepolia — which the production default (Base + Celo mainnet) rejects.
// Must be set before the route is imported.
process.env.NEXT_PUBLIC_SUPPORTED_CHAIN_IDS = '11142220,8453,42220';

const { POST } = await import('./route');
const { PaymentNotVerifiedError } = await import('@/lib/agent/orchestrator');

const CHAIN_ID = celoSepolia.id;
const VERIFIED_AMOUNT = 50_000_000_000_000_000n; // 0.05 cUSD (18 decimals)

// A Supabase test double recording every insert/update payload, with
// configurable per-call errors. Mirrors the chained shape the route uses:
//   await supabase.from('threads').insert({...})
//   await supabase.from('threads').update({...}).eq(...).eq(...)
function makeSupabase(opts: { insertError?: { code?: string; message: string }; updateError?: { message: string } } = {}) {
  const inserts: Array<Record<string, unknown>> = [];
  const updates: Array<Record<string, unknown>> = [];
  const orphans: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      return {
        upsert(payload: Record<string, unknown>) {
          if (table === 'orphan_payments') orphans.push(payload);
          return Promise.resolve({ error: null });
        },
        insert(payload: Record<string, unknown>) {
          inserts.push(payload);
          return Promise.resolve({ error: opts.insertError ?? null });
        },
        update(payload: Record<string, unknown>) {
          updates.push(payload);
          const chain = {
            eq: () => chain,
            then: (resolve: (v: { error: unknown }) => unknown) =>
              Promise.resolve({ error: opts.updateError ?? null }).then(resolve),
          };
          return chain;
        },
      };
    },
  };
  return { client, inserts, updates, orphans };
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/generate/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function readSSE(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}

// Mode A body. amountPaidRaw is deliberately a wrong/garbage value: the route
// must persist the on-chain *verified* amount, never this client field.
const bodyA = {
  threadId: '42',
  chainId: CHAIN_ID,
  walletAddress: '0x1111111111111111111111111111111111111111',
  tokenSymbol: 'cUSD' as const,
  tokenAddress: '0xb7e155e9d4ab5a97f950c3259dace91b0f6c33f5',
  amountPaidRaw: '999999999999999999999', // hostile: not what we persist
  payTxHash: '0xabc',
  mode: 0 as const,
  topic: 'zk rollups',
  audience: 'beginner' as const,
};

const bodyB = {
  ...bodyA,
  mode: 1 as const,
  topic: undefined,
  eventDescription: 'token X depegged',
  angle: 'skeptical' as const,
};

describe('POST /api/generate/stream', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyPayment.mockResolvedValue({ amountRaw: VERIFIED_AMOUNT });
    runModeA.mockResolvedValue({
      tweets: ['tweet 1', 'tweet 2'],
      searchSummary: null,
      totalCostUsd: MODE_A_TOTAL_COST_USD,
    });
    runModeB.mockResolvedValue({
      tweets: ['hot 1', 'hot 2'],
      searchSummary: 'summary',
      marketSnippet: 'snippet',
      totalCostUsd: '0.123',
    });
  });

  describe('input validation (before any work)', () => {
    it('returns 400 on a non-JSON body without verifying payment', async () => {
      const req = new Request('http://localhost/api/generate/stream', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{ not json',
      });
      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(verifyPayment).not.toHaveBeenCalled();
    });

    it('returns 400 when a required field is missing', async () => {
      const res = await POST(postReq({ ...bodyA, topic: undefined }));
      expect(res.status).toBe(400);
      expect(await res.text()).toContain('topic required');
      expect(verifyPayment).not.toHaveBeenCalled();
    });

    it('returns 400 on an out-of-range mode', async () => {
      const res = await POST(postReq({ ...bodyA, mode: 7 }));
      expect(res.status).toBe(400);
      expect(verifyPayment).not.toHaveBeenCalled();
    });
  });

  describe('payment gate (no paid work before on-chain proof)', () => {
    it('returns 402 and spends nothing when verifyPayment rejects', async () => {
      const { client, inserts, orphans } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);
      verifyPayment.mockRejectedValue(new Error('threadId does not match'));
      const res = await POST(postReq(bodyA));
      expect(res.status).toBe(402);
      expect(await res.text()).toContain('payment not verified');
      // No thread row, no pipeline, no x402 spend. (A Supabase client IS now
      // obtained before the gate — the orphan record below needs one — but a
      // plain Error carries no failure kind, so nothing is written at all.)
      expect(inserts).toHaveLength(0);
      expect(orphans).toHaveLength(0);
      expect(runModeA).not.toHaveBeenCalled();
      expect(runModeB).not.toHaveBeenCalled();
    });

    // The 402 fires before the threads insert, so without this a real payment
    // the server merely could not read leaves no trace anywhere: not in
    // history, not in the refund queue, not in the nightly sweep.
    it('records an unreadable payment for triage, and says so', async () => {
      const { client, inserts, orphans } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);
      verifyPayment.mockRejectedValue(
        new PaymentNotVerifiedError('receipt-unavailable', 'payment tx not found on chain'),
      );

      const res = await POST(postReq(bodyA));
      expect(res.status).toBe(402);
      expect(await res.text()).toContain('recorded for review');
      expect(orphans).toHaveLength(1);
      expect(orphans[0]).toMatchObject({
        chain_id: CHAIN_ID,
        reason: 'receipt-unavailable',
        pay_tx_hash: bodyA.payTxHash.toLowerCase(),
      });
      // Still no thread row: an unverified payment must not become a thread.
      expect(inserts).toHaveLength(0);
      expect(runModeA).not.toHaveBeenCalled();
    });

    it('records a payment our contract really took but the body described wrongly', async () => {
      const { client, orphans } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);
      verifyPayment.mockRejectedValue(
        new PaymentNotVerifiedError('mismatch', 'payer does not match the payment tx', {
          threadId: '99',
          amountRaw: '50000',
        }),
      );

      const res = await POST(postReq(bodyA));
      expect(res.status).toBe(402);
      expect(orphans[0]).toMatchObject({
        reason: 'mismatch',
        observed_thread_id: '99',
        observed_amount_raw: '50000',
      });
    });

    it('records nothing when the chain proves no payment reached us', async () => {
      const { client, orphans } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);
      verifyPayment.mockRejectedValue(
        new PaymentNotVerifiedError('no-payment-event', 'no ThreadRequested event'),
      );

      const res = await POST(postReq(bodyA));
      expect(res.status).toBe(402);
      expect(await res.text()).not.toContain('recorded for review');
      expect(orphans).toHaveLength(0);
    });
  });

  describe('replay guard (one generation per payment, fail closed)', () => {
    it('returns 409 on a unique-violation and never runs the pipeline', async () => {
      const { client, inserts } = makeSupabase({
        insertError: { code: '23505', message: 'duplicate key' },
      });
      getSupabaseServer.mockReturnValue(client);

      const res = await POST(postReq(bodyA));
      expect(res.status).toBe(409);
      expect(inserts).toHaveLength(1); // attempted the guard insert
      expect(runModeA).not.toHaveBeenCalled(); // but spent zero x402
    });

    it('returns 503 (fail closed) on any other insert error, with zero spend', async () => {
      const { client } = makeSupabase({
        insertError: { code: '42501', message: 'permission denied' },
      });
      getSupabaseServer.mockReturnValue(client);

      const res = await POST(postReq(bodyA));
      expect(res.status).toBe(503);
      expect(runModeA).not.toHaveBeenCalled();
      expect(runModeB).not.toHaveBeenCalled();
    });
  });

  describe('happy path (Mode A)', () => {
    it('persists the VERIFIED amount (not the client field) on the pending insert', async () => {
      const { client, inserts } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);

      await readSSE(await POST(postReq(bodyA)));

      expect(inserts).toHaveLength(1);
      expect(inserts[0].amount_paid_raw).toBe(VERIFIED_AMOUNT.toString());
      expect(inserts[0].amount_paid_raw).not.toBe(bodyA.amountPaidRaw);
      expect(inserts[0].status).toBe('pending');
    });

    it('streams started → final tweets → done and marks the row completed', async () => {
      const { client, updates } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);

      const res = await POST(postReq(bodyA));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const sse = await readSSE(res);
      expect(sse).toContain('"type":"started"');
      expect(sse).toContain('"type":"done"');
      expect(sse).toContain('tweet 1');

      expect(runModeA).toHaveBeenCalledOnce();
      expect(updates).toHaveLength(1);
      expect(updates[0].status).toBe('completed');
      expect(updates[0].tweets).toEqual(['tweet 1', 'tweet 2']);
      expect(updates[0].total_cost_usd).toBe(MODE_A_TOTAL_COST_USD);
    });

    // The user reloads, swipes back, or the webview is reclaimed mid-run. The
    // browser is gone but the money is not: the run must finish and land in the
    // database, where /history and the resume path can both find it. Before
    // this was guarded, the first emit after the disconnect threw
    // "Invalid state: Controller is already closed" and a paid run with a
    // settled Groq call was written off as failed with no tweets.
    it('finishes a run whose client disappeared mid-stream', async () => {
      const { client, updates } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);

      let releaseClientGone!: () => void;
      const clientGone = new Promise<void>((resolve) => {
        releaseClientGone = resolve;
      });

      runModeA.mockImplementation(
        async (
          _ctx: unknown,
          emit: (e: import('@/lib/pipeline/types').PipelineEvent) => void,
        ) => {
          await clientGone;
          // Same order the real pipeline uses: settle, then hand over content.
          emit({
            type: 'step_settled',
            step: 'groq',
            txHash: '0xdead',
            costAmount: '0.001',
            tokenSymbol: 'cUSD',
            chainId: CHAIN_ID,
          });
          emit({ type: 'step_output', step: 'groq', output: { final: true, tweets: ['tweet 1', 'tweet 2'] } });
          return {
            tweets: ['tweet 1', 'tweet 2'],
            searchSummary: null,
            totalCostUsd: MODE_A_TOTAL_COST_USD,
          };
        },
      );

      const res = await POST(postReq(bodyA));
      // Exactly what a reload does to the response body.
      await res.body!.cancel();
      releaseClientGone();

      await vi.waitFor(() => expect(updates).toHaveLength(1));
      expect(updates[0].status).toBe('completed');
      expect(updates[0].tweets).toEqual(['tweet 1', 'tweet 2']);
      // Bookkeeping inside emit must survive too, or the receipt loses the tx.
      expect(updates[0].groq_tx_hash).toBe('0xdead');
    });
  });

  describe('happy path (Mode B)', () => {
    it('runs runModeB and persists its summary/snippet/cost', async () => {
      const { client, updates } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);

      const sse = await readSSE(await POST(postReq(bodyB)));
      expect(sse).toContain('"type":"done"');

      expect(runModeB).toHaveBeenCalledOnce();
      expect(runModeA).not.toHaveBeenCalled();
      expect(updates[0].status).toBe('completed');
      expect(updates[0].tweets).toEqual(['hot 1', 'hot 2']);
      expect(updates[0].search_summary).toBe('summary');
      expect(updates[0].market_snippet).toBe('snippet');
      expect(updates[0].total_cost_usd).toBe('0.123');
    });
  });

  describe('groq settle chain persistence', () => {
    it('persists the x402 settle chain (Base 8453) from the groq step_settled event', async () => {
      const { client, updates } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);
      runModeA.mockImplementation(
        (_ctx: unknown, emit: (e: Record<string, unknown>) => void) => {
          emit({ type: 'step_settled', step: 'groq', txHash: '0xbase', costAmount: '0.001', tokenSymbol: 'USDC', chainId: 8453 });
          return Promise.resolve({ tweets: ['t1', 't2'], searchSummary: null, totalCostUsd: MODE_A_TOTAL_COST_USD });
        },
      );

      await readSSE(await POST(postReq(bodyA)));

      expect(updates).toHaveLength(1);
      expect(updates[0].status).toBe('completed');
      expect(updates[0].groq_settle_chain_id).toBe(8453);
    });

    it('falls back to the payment chain (legacy) when the groq event carries no chainId', async () => {
      const { client, updates } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);
      runModeA.mockImplementation(
        (_ctx: unknown, emit: (e: Record<string, unknown>) => void) => {
          emit({ type: 'step_settled', step: 'groq', txHash: '0xcelo', costAmount: '0.010', tokenSymbol: 'cUSD' });
          return Promise.resolve({ tweets: ['t1', 't2'], searchSummary: null, totalCostUsd: MODE_A_TOTAL_COST_USD });
        },
      );

      await readSSE(await POST(postReq(bodyA)));

      expect(updates[0].groq_settle_chain_id).toBe(CHAIN_ID); // celoSepolia.id = 11142220
    });
  });

  describe('failure path (clean, refundable state)', () => {
    it('emits fatal and marks the row failed when the pipeline throws', async () => {
      runModeA.mockRejectedValue(new Error('groq exploded'));
      const { client, updates } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);

      const sse = await readSSE(await POST(postReq(bodyA)));
      expect(sse).toContain('"type":"fatal"');
      expect(sse).toContain('groq exploded');

      expect(updates).toHaveLength(1);
      expect(updates[0].status).toBe('failed');
      expect(updates[0].error_message).toBe('groq exploded');
    });
  });

  describe('deadline abort (no x402 spend after the run is declared failed)', () => {
    it('passes a live, non-aborted AbortSignal into the pipeline ctx', async () => {
      const { client } = makeSupabase();
      getSupabaseServer.mockReturnValue(client);
      let captured: { signal?: AbortSignal } | undefined;
      runModeA.mockImplementation((ctx: { signal?: AbortSignal }) => {
        captured = ctx;
        return Promise.resolve({ tweets: ['a', 'b'] });
      });

      await readSSE(await POST(postReq(bodyA)));

      expect(captured?.signal).toBeInstanceOf(AbortSignal);
      expect(captured?.signal?.aborted).toBe(false);
    });

    it('aborts that signal when the internal deadline fires, and emits fatal', async () => {
      vi.useFakeTimers();
      try {
        const { client } = makeSupabase();
        getSupabaseServer.mockReturnValue(client);
        let captured: { signal?: AbortSignal } | undefined;
        // Pipeline hangs forever — only the internal deadline can end the run.
        runModeA.mockImplementation((ctx: { signal?: AbortSignal }) => {
          captured = ctx;
          return new Promise<never>(() => {});
        });

        const res = await POST(postReq(bodyA));
        const ssePromise = readSSE(res);
        await vi.advanceTimersByTimeAsync(150_000);
        const sse = await ssePromise;

        expect(captured?.signal?.aborted).toBe(true);
        expect(sse).toContain('"type":"fatal"');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('degraded mode (Supabase down)', () => {
    it('still serves the generation when the DB client cannot be created', async () => {
      // getSupabaseServer throws → getSupabaseSafe() returns null → the route
      // serves without the replay guard (documented degraded mode), rather
      // than taking generation fully offline on a DB outage.
      getSupabaseServer.mockImplementation(() => {
        throw new Error('Supabase env vars missing');
      });

      const res = await POST(postReq(bodyA));
      expect(res.status).toBe(200);
      const sse = await readSSE(res);
      expect(sse).toContain('"type":"done"');
      expect(runModeA).toHaveBeenCalledOnce();
    });
  });
});

// body.chainId is fully attacker-controlled. An unknown chain must be turned
// away by an explicit allowlist, before any Supabase query, RPC call or paid
// work — not incidentally, by getContracts() throwing a 500 further in.
describe('chain allowlist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unsupported chainId with 400 and does no work', async () => {
    const res = await POST(
      new Request('http://localhost/api/generate/stream', {
        method: 'POST',
        body: JSON.stringify({
          threadId: '1',
          chainId: 1, // Ethereum mainnet — not supported
          walletAddress: '0x5028000000000000000000000000000000009779',
          tokenSymbol: 'USDC',
          tokenAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
          amountPaidRaw: '100000',
          payTxHash: '0xdeadbeef',
          mode: 0,
          topic: 'test',
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain('unsupported chainId');
    // The gate is before every side effect: no payment proof, no DB.
    expect(verifyPayment).not.toHaveBeenCalled();
    expect(getSupabaseServer).not.toHaveBeenCalled();
  });
});
