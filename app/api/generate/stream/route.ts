import { getMode } from '@/lib/pipeline/modes';
import { getContracts } from '@/lib/contracts';
import { isSupportedChain } from '@/lib/chainPolicy';
import { PaymentNotVerifiedError, verifyPayment } from '@/lib/agent/orchestrator';
import { recordOrphanPayment } from '@/lib/agent/orphanPayments';
import { getSupabaseServer } from '@/lib/supabase';
import { claimGenerationOnce } from '@/lib/rateLimit';
import type { Address, Hex } from 'viem';
import type { PipelineEvent } from '@/lib/pipeline/types';
import type { Angle } from '@/lib/prompts/modeB';
import type { EventContext } from '@/lib/eventContext';

interface StreamRequest {
  threadId: string;
  chainId: number;
  walletAddress: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  tokenAddress: string;
  amountPaidRaw: string;
  payTxHash: string;
  mode: number;
  // Mode A
  topic?: string;
  audience?: 'beginner' | 'intermediate' | 'advanced';
  // Mode B
  eventDescription?: string;
  angle?: Angle;
  eventContext?: EventContext | null;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Mode B = Serper + CoinGecko + 2 LLM calls + x402 receipt waits. Pin the
// function ceiling explicitly so a slow run can't be killed mid-generation
// (user paid, no content, thread stuck 'pending') by a lower platform default.
export const maxDuration = 300;

// Internal deadline well under maxDuration. A platform SIGKILL at 300s is a
// hard kill with no cleanup — the thread is left 'pending' with no `fatal`
// emitted (worst state: paid, no content, can't self-refund). Racing an
// internal timeout instead routes a hung run through the normal catch:
// thread -> 'failed', `fatal` emitted, refundable. (The orphaned pipeline may
// keep running in the background until maxDuration; true cancellation needs
// AbortController plumbed through every step — a separate, larger change.)
const PIPELINE_DEADLINE_MS = 150_000;

function withDeadline<T>(p: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Signal the orphaned pipeline to stop before it can settle (spend) for a
      // run we're about to declare `fatal`/refundable.
      onTimeout?.();
      reject(new Error(`generation exceeded ${ms / 1000}s deadline`));
    }, ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function sseLine(e: PipelineEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

function getSupabaseSafe() {
  try {
    return getSupabaseServer();
  } catch {
    return null;
  }
}

function validate(b: Partial<StreamRequest>): string | null {
  if (!b.threadId) return 'threadId required';
  // threadId is proved against the chain as a BigInt but persisted as TEXT
  // under the unique (chain_id, onchain_thread_id) index. BigInt() accepts many
  // spellings of one number — '0x2a', ' 42', '+42' are all 42 — so an
  // unnormalized string passes the payment proof and still lands as a DISTINCT
  // row: another generation off one payment, and later another refund off it
  // too (the refund worker keys on this same text). Reject the exotic spellings
  // here; canonicalizeThreadId below collapses the ones that survive ('042').
  if (!/^[0-9]{1,78}$/.test(b.threadId)) return 'malformed threadId';
  if (!b.chainId) return 'chainId required';
  // Explicit allowlist. Relying on getContracts() to throw made an unsupported
  // chain a 500 raised partway through the route; it must be a 400 raised
  // before anything happens.
  if (!isSupportedChain(b.chainId)) return 'unsupported chainId';
  if (!b.walletAddress) return 'walletAddress required';
  if (!b.tokenSymbol) return 'tokenSymbol required';
  if (!b.tokenAddress) return 'tokenAddress required';
  if (!b.amountPaidRaw) return 'amountPaidRaw required';
  if (!b.payTxHash) return 'payTxHash required';
  const mode = getMode(b.mode);
  if (!mode) return 'unknown mode';
  return mode.validateInput(b);
}

// Plain decimal, no leading zeros — the single spelling that reaches the DB, so
// the unique index actually sees a replay as a duplicate. `/^[0-9]{1,78}$/` has
// already run, so BigInt cannot throw here.
function canonicalizeThreadId(raw: string): string {
  return BigInt(raw).toString();
}

export async function POST(req: Request) {
  let body: StreamRequest;
  try {
    body = (await req.json()) as StreamRequest;
  } catch {
    return new Response('invalid json body', { status: 400 });
  }

  const err = validate(body);
  if (err) return new Response(err, { status: 400 });

  // Every DB read/write below uses this, never body.threadId.
  const threadId = canonicalizeThreadId(body.threadId);

  // Prove the payment on-chain BEFORE opening the stream or spending any
  // x402. Without this, the body is forgeable and anyone can drain the agent
  // wallet for free. Reject (402) on any mismatch.
  const supabase = getSupabaseSafe();

  let verifiedAmountRaw: string;
  try {
    const { amountRaw } = await verifyPayment({
      chainId: body.chainId,
      payTxHash: body.payTxHash as Hex,
      threadId: BigInt(threadId),
      walletAddress: body.walletAddress as Address,
      tokenAddress: body.tokenAddress as Address,
      mode: body.mode,
    });
    verifiedAmountRaw = amountRaw.toString();
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'payment verification failed';
    // This 402 returns before any thread row exists, so without the line below
    // a real payment we merely could not read leaves NO trace anywhere: not in
    // history, not in the refund queue, not in the nightly sweep. Only the
    // ambiguous rejections are recorded, and only for a human to triage —
    // nothing downstream sends money off this table.
    const recorded =
      e instanceof PaymentNotVerifiedError &&
      (await recordOrphanPayment(supabase, {
        chainId: body.chainId,
        payTxHash: body.payTxHash,
        walletAddress: body.walletAddress,
        claimedThreadId: threadId,
        tokenAddress: body.tokenAddress,
        mode: body.mode,
        kind: e.kind,
        detail: msg,
        observed: e.observed,
      }));
    return new Response(
      `payment not verified: ${msg}${recorded ? ' — your payment has been recorded for review' : ''}`,
      { status: 402 },
    );
  }

  // Replay guard: the pending row also enforces one generation per payment
  // via the unique (chain_id, onchain_thread_id) index. Insert BEFORE opening
  // the stream so a replayed payment is rejected with a real status and zero
  // x402 spend — not logged-and-continued. Trade-off: if Supabase is down we
  // lose this guard (degraded mode) so a DB outage doesn't take generation
  // fully offline; verifyPayment still bounds abuse to real payers + the cap.
  if (supabase) {
    const { error } = await supabase.from('threads').insert({
      chain_id: body.chainId,
      onchain_thread_id: threadId,
      wallet_address: body.walletAddress.toLowerCase(),
      mode: body.mode,
      token_symbol: body.tokenSymbol,
      token_address: body.tokenAddress.toLowerCase(),
      amount_paid_raw: verifiedAmountRaw,
      pay_tx_hash: body.payTxHash.toLowerCase(),
      topic: body.topic ?? body.eventDescription ?? null,
      audience: body.audience ?? null,
      angle: body.angle ?? null,
      status: 'pending',
    });
    if (error) {
      // 23505 = unique_violation → this payment was already generated.
      if (error.code === '23505') {
        return new Response('thread already generated for this payment', { status: 409 });
      }
      // Can't prove this isn't a replay — fail closed rather than spend x402.
      console.error('[supabase] insert pending failed:', error.message);
      return new Response('could not record generation attempt', { status: 503 });
    }
  } else {
    // Supabase unreachable → the unique-index replay guard above was skipped.
    // Fall back to a Redis SET NX on the payment so a replayed payTxHash still
    // can't generate (and spend x402) twice during the outage window. Only on
    // this branch: in the Supabase path the index is the guard, and reusing
    // Redis there would block legitimate retries after a transient DB error.
    const claim = await claimGenerationOnce(
      `${body.chainId}:${body.payTxHash.toLowerCase()}`,
    );
    if (claim === 'replay') {
      return new Response('thread already generated for this payment', { status: 409 });
    }
    // 'claimed' or 'unavailable' (dual outage) → proceed; verifyPayment + the
    // on-chain daily cap still bound abuse.
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();

      const txByStep: Partial<Record<'groq' | 'serper' | 'factCheck', string>> = {};
      let capturedTweets: string[] | null = null;
      let groqSettleChainId: number | null = null;

      // The browser can leave at any moment — reload, Android back gesture, or
      // the webview being reclaimed. Once it does, `controller.enqueue` throws
      // and, unguarded, that throw travelled up through the pipeline into the
      // catch below: a run the user had already paid for, with a settled Groq
      // call, written off as `failed` with no tweets. The disconnect itself
      // manufactured the failure. Now it only ends the streaming, never the run.
      let clientGone = false;

      const emit = (e: PipelineEvent) => {
        if (e.type === 'step_settled' && e.step !== 'coingecko' && e.txHash !== '0x0') {
          if (e.step === 'groq' || e.step === 'serper' || e.step === 'factCheck') {
            txByStep[e.step] = e.txHash;
          }
        }
        if (e.type === 'step_settled' && e.step === 'groq') {
          groqSettleChainId = e.chainId ?? body.chainId;
        }
        if (
          e.type === 'step_output' &&
          e.step === 'groq' &&
          Array.isArray(e.output)
        ) {
          capturedTweets = e.output as string[];
        }
        // Bookkeeping above always runs: it is what lets the DB write below
        // record the settled tx hashes and the tweets even with nobody watching.
        if (clientGone) return;
        try {
          controller.enqueue(encoder.encode(sseLine(e)));
        } catch {
          // Nobody is listening any more. Keep generating — the thread is paid
          // for, and it still has to reach the database, where /history and the
          // resume path both look for it.
          clientGone = true;
        }
      };

      // Flush an initial byte so Vercel's 25s first-byte timeout doesn't
      // kill the connection while the first AI call is still running.
      emit({ type: 'started', paidAmountRaw: verifiedAmountRaw });

      try {
        const contracts = getContracts(body.chainId);
        // Aborts when the deadline fires; pipeline steps check it before settling.
        const ac = new AbortController();
        const baseCtx = {
          chainId: body.chainId,
          threadId: BigInt(threadId),
          topic: body.topic ?? body.eventDescription ?? '',
          audience: body.audience ?? 'beginner',
          agentWallet: contracts.AgentWallet,
          // Verified payment token (verifyPayment asserted it matches the
          // ThreadRequested event). x402 settles spend this token — see
          // PipelineContext.tokenSymbol.
          tokenSymbol: body.tokenSymbol,
          signal: ac.signal,
        } as const;

        let tweets: string[];
        let totalCostUsd: string;
        let searchSummary: string | null = null;
        let marketSnippet: string | null = null;

        const modeDef = getMode(body.mode);
        if (!modeDef) throw new Error('unknown mode'); // validated already; defensive
        const out = await withDeadline(
          modeDef.run(baseCtx, body, emit),
          PIPELINE_DEADLINE_MS,
          () => ac.abort(),
        );
        tweets = out.tweets;
        totalCostUsd = out.totalCostUsd;
        searchSummary = out.searchSummary;
        marketSnippet = out.marketSnippet;

        if (supabase) {
          const { error } = await supabase
            .from('threads')
            .update({
              tweets,
              total_cost_usd: totalCostUsd,
              groq_tx_hash: txByStep.groq ?? null,
              serper_tx_hash: txByStep.serper ?? null,
              fact_check_tx_hash: txByStep.factCheck ?? null,
              search_summary: searchSummary,
              market_snippet: marketSnippet,
              status: 'completed',
              groq_settle_chain_id: groqSettleChainId,
            })
            .eq('chain_id', body.chainId)
            .eq('onchain_thread_id', threadId);
          if (error) console.error('[supabase] update completed failed:', error.message);
        }

        emit({
          type: 'step_output',
          step: 'groq',
          output: { final: true, tweets },
        });
        emit({ type: 'done', totalCostUsd });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'pipeline failed';

        if (supabase) {
          // Persist partial state on failure so admin can recover/refund the user.
          const { error } = await supabase
            .from('threads')
            .update({
              tweets: capturedTweets,
              status: 'failed',
              error_message: msg,
              groq_tx_hash: txByStep.groq ?? null,
              groq_settle_chain_id: groqSettleChainId,
              serper_tx_hash: txByStep.serper ?? null,
              fact_check_tx_hash: txByStep.factCheck ?? null,
            })
            .eq('chain_id', body.chainId)
            .eq('onchain_thread_id', threadId);
          if (error) console.error('[supabase] update failed failed:', error.message);
        }

        emit({ type: 'fatal', error: msg });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed by the client going away. Closing twice throws, and
          // this one would land in the middle of the failure path.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
