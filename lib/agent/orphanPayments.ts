import type { SupabaseClient } from '@supabase/supabase-js';
import type { ObservedPayment, PaymentFailureKind } from './orchestrator';

// The last way a paid user could end up with no record anywhere.
//
// /api/generate/stream answers 402 BEFORE it inserts the thread row, so a
// rejected request leaves nothing behind. For a forged body that is exactly
// right. For a real payment the server could not read — a lagging RPC, a
// repricing mid-flight — it means the money left the wallet and no refund path,
// sweep or history page will ever see it. Base threads 1000007 and 1000008 were
// lost that way.
//
// So the ambiguous rejections get a row here. This table is a TRIAGE QUEUE for a
// human: it never enqueues a refund and never moves money. A row is a lead to
// check on the explorer, not a proven debt — which is what lets it accept the
// one case (`receipt-unavailable`) where a fabricated hash and a real payment
// are indistinguishable. Anyone can therefore make rows appear by POSTing
// invented hashes; the unique index collapses repeats, and nothing downstream
// acts on a row without a person looking first.

/**
 * Could money have moved despite the rejection?
 *
 * `mismatch` means our contract emitted ThreadRequested — a payment definitely
 * happened, the body just described it wrongly. `receipt-unavailable` means we
 * could not tell. The other two are proof that nothing was paid to us.
 */
export function paymentMayHaveMoved(kind: PaymentFailureKind): boolean {
  return kind === 'receipt-unavailable' || kind === 'mismatch';
}

export interface OrphanPaymentInput {
  chainId: number;
  payTxHash: string;
  /** As claimed by the request; the observed payer, when known, is separate. */
  walletAddress: string;
  claimedThreadId: string;
  tokenAddress: string;
  mode: number;
  kind: PaymentFailureKind;
  detail: string;
  observed?: ObservedPayment;
}

/**
 * Record a rejected-but-possibly-real payment. Returns whether a row was
 * written, so the caller can tell the user their payment is on somebody's list.
 *
 * Never throws: this runs inside the 402 path, and failing to record must not
 * turn a clean rejection into a 500.
 */
export async function recordOrphanPayment(
  supabase: SupabaseClient | null,
  input: OrphanPaymentInput,
): Promise<boolean> {
  if (!supabase) return false;
  if (!paymentMayHaveMoved(input.kind)) return false;

  try {
    const { error } = await supabase.from('orphan_payments').upsert(
      {
        chain_id: input.chainId,
        pay_tx_hash: input.payTxHash.toLowerCase(),
        wallet_address: input.walletAddress.toLowerCase(),
        claimed_thread_id: input.claimedThreadId,
        token_address: input.tokenAddress.toLowerCase(),
        mode: input.mode,
        reason: input.kind,
        detail: input.detail.slice(0, 500),
        observed_thread_id: input.observed?.threadId ?? null,
        observed_payer: input.observed?.user?.toLowerCase() ?? null,
        observed_amount_raw: input.observed?.amountRaw ?? null,
      },
      // Keep the FIRST observation: a retry that fails differently should not
      // overwrite what we saw the first time.
      { onConflict: 'chain_id,pay_tx_hash', ignoreDuplicates: true },
    );
    if (error) {
      console.error('[orphan] could not record rejected payment:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[orphan] could not record rejected payment:', e);
    return false;
  }
}

/** Open rows, for the nightly page. Returns null when the count is unavailable. */
export async function countOpenOrphanPayments(
  supabase: SupabaseClient,
): Promise<number | null> {
  const { count, error } = await supabase
    .from('orphan_payments')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open');
  if (error) {
    console.error('[orphan] count failed:', error.message);
    return null;
  }
  return count ?? 0;
}
