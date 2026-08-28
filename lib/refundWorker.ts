/**
 * One queued refund, processed safely — the sequence that actually moves money.
 *
 * Lifted out of scripts/process-refund-request.ts unchanged in behaviour, for
 * two reasons. `pnpm test:lib` runs `lib app`, so while this lived in scripts/
 * the most safety-critical code in the repo had ZERO tests. And the queue
 * drainer needs the identical sequence — a second copy of it is exactly how two
 * refund paths drift until one of them double-sends.
 *
 * The safety properties, in the order they are enforced:
 *   1. `threads.refund_tx_hash` is the source of truth. Set => paid out once
 *      already => never send again, whatever the queue row says.
 *   2. The amount comes from THIS thread's own ThreadRequested event, never
 *      from requiredAmount() at head — the price is settable.
 *   3. pending -> processing is a compare-and-swap. Supabase does not error on
 *      zero rows matched, so the update must be inspected: only the worker whose
 *      UPDATE actually flipped the row may send.
 *   4. A send that throws leaves the row in 'processing' and does NOT revert.
 *      refundThread may have broadcast and only thrown waiting for the receipt,
 *      so the transfer can still mine; reverting would let a retry double-send.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatUnits, parseUnits, type Hex } from 'viem';
import { refundThread, getOnChainPaidAmount } from './agent/orchestrator';
import { getTokens } from './tokens';
import { alertOps } from './alert';

export type RefundKind = 'full' | 'partial' | 'slow-cancel';
export type TokenSymbol = 'cUSD' | 'USDT' | 'USDC';

export type RefundOutcome =
  | { status: 'sent'; txHash: Hex; amountHuman: string }
  | { status: 'already-refunded'; txHash: string }
  | { status: 'not-pending'; actual: string }
  | { status: 'lost-lock' };

/** Full refunds the whole payment, slow-cancel half of it, and partial only
 *  what an operator names. A partial with no amount is a REFUSAL, not a
 *  default: how much a degraded thread was worth is a human judgement, and
 *  guessing it here is how an automated drainer would over-refund. */
export function computeAmount(opts: {
  kind: RefundKind;
  paidRaw: bigint;
  decimals: number;
  override?: string;
}): string {
  if (opts.kind === 'partial') {
    if (!opts.override) {
      throw new Error('partial refunds require an explicit amount');
    }
    if (!/^\d+(\.\d+)?$/.test(opts.override)) {
      throw new Error('amount must be a positive decimal string');
    }
    const raw = parseUnits(opts.override, opts.decimals);
    if (raw <= 0n) {
      throw new Error('amount must be greater than 0');
    }
    if (raw > opts.paidRaw) {
      throw new Error(
        `amount ${opts.override} exceeds amount paid (${formatUnits(opts.paidRaw, opts.decimals)}) — refusing over-refund`,
      );
    }
    return opts.override;
  }
  const raw = opts.kind === 'full' ? opts.paidRaw : opts.paidRaw / 2n;
  return formatUnits(raw, opts.decimals);
}

export async function processRefundRequest(params: {
  supabase: SupabaseClient;
  requestId: number;
  amountOverride?: string;
  log?: (line: string) => void;
}): Promise<RefundOutcome> {
  const { supabase, requestId, amountOverride } = params;
  const log = params.log ?? (() => {});

  const { data: request, error: reqErr } = await supabase
    .from('refund_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (reqErr || !request) throw new Error(`refund_requests #${requestId} not found: ${reqErr?.message}`);
  if (request.status !== 'pending') return { status: 'not-pending', actual: request.status };

  const { data: thread, error: thrErr } = await supabase
    .from('threads')
    .select('token_symbol, refund_tx_hash, pay_tx_hash')
    .eq('chain_id', request.chain_id)
    .eq('onchain_thread_id', request.onchain_thread_id)
    .single();
  if (thrErr || !thread) throw new Error(`parent thread not found: ${thrErr?.message}`);

  // (1) Idempotency across both refund paths: /api/refund and this worker both
  // stamp threads.refund_tx_hash. Already set => paid out once => never again.
  if (thread.refund_tx_hash) {
    await supabase
      .from('refund_requests')
      .update({ status: 'completed', refund_tx_hash: thread.refund_tx_hash })
      .eq('id', requestId);
    return { status: 'already-refunded', txHash: thread.refund_tx_hash };
  }

  const tokenSymbol = thread.token_symbol as TokenSymbol;
  const token = getTokens(request.chain_id)[tokenSymbol];
  if (!token) throw new Error(`token ${tokenSymbol} not configured for chain ${request.chain_id}`);

  // (2) Trustless paid amount, from this thread's own event.
  const paidRaw = await getOnChainPaidAmount({
    chainId: request.chain_id,
    payTxHash: thread.pay_tx_hash as Hex,
    threadId: BigInt(request.onchain_thread_id),
  });
  const amountHuman = computeAmount({
    kind: request.kind as RefundKind,
    paidRaw,
    decimals: token.decimals,
    override: amountOverride,
  });
  const reason = `request #${requestId} — ${request.kind}`;

  log(`  #${requestId} → ${request.wallet_address} ${amountHuman} ${tokenSymbol} (${request.kind})`);

  // (3) Compare-and-swap lock. Zero rows matched is not an error here, so the
  // returned rows must be counted, not merely checked for an error.
  const { data: locked, error: lockErr } = await supabase
    .from('refund_requests')
    .update({ status: 'processing' })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id');
  if (lockErr) throw new Error(`failed to lock request: ${lockErr.message}`);
  if (!locked || locked.length !== 1) return { status: 'lost-lock' };

  let txHash: Hex;
  try {
    txHash = await refundThread({
      chainId: request.chain_id,
      onchainThreadId: request.onchain_thread_id,
      to: request.wallet_address as Hex,
      tokenSymbol,
      amountHuman,
      reason,
    });
  } catch (e) {
    // (4) Leave it 'processing'. The CAS lock then blocks every retry until a
    // human has checked the chain.
    const msg = e instanceof Error ? e.message : String(e);
    await supabase
      .from('refund_requests')
      .update({ rejection_reason: `send failed, on-chain state UNKNOWN: ${msg}` })
      .eq('id', requestId);
    await alertOps('refund send FAILED — verify on-chain before retry (queue worker)', {
      requestId,
      chainId: request.chain_id,
      onchainThreadId: request.onchain_thread_id,
      to: request.wallet_address,
      error: msg,
    });
    throw e;
  }

  await supabase
    .from('refund_requests')
    .update({ status: 'completed', refund_tx_hash: txHash, processed_at: new Date().toISOString() })
    .eq('id', requestId);

  await supabase
    .from('threads')
    .update({ refund_tx_hash: txHash, refund_reason: reason })
    .eq('chain_id', request.chain_id)
    .eq('onchain_thread_id', request.onchain_thread_id);

  return { status: 'sent', txHash, amountHuman };
}
