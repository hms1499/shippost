/**
 * Atomically process a queued refund request:
 *   1. Read refund_requests row + its parent threads row
 *   2. Compute amount (full=100%, slow-cancel=50%, partial=admin --amount)
 *   3. On-chain ERC20 transfer from reserve EOA → user
 *   4. Update both refund_requests and threads with tx hash
 *
 * Usage:
 *   pnpm refund:process <requestId> [--amount=0.02]
 *
 * Requires REFUND_ADMIN_KEY to be set (just a presence check — protects
 * against accidental runs in the wrong shell, not an authorization layer).
 */
import 'dotenv/config';
import { formatUnits } from 'viem';
import { refundThread } from '../lib/agent/orchestrator';
import { getTokens } from '../lib/tokens';
import { getSupabaseServer } from '../lib/supabase';

type TokenSymbol = 'cUSD' | 'USDT' | 'USDC';

function parseArgs() {
  const args = process.argv.slice(2);
  const requestIdStr = args.find((a) => !a.startsWith('--'));
  const amountFlag = args.find((a) => a.startsWith('--amount='))?.split('=')[1];
  if (!requestIdStr) {
    console.log('usage: pnpm refund:process <requestId> [--amount=0.02]');
    process.exit(1);
  }
  const requestId = Number(requestIdStr);
  if (!Number.isFinite(requestId)) {
    console.error('requestId must be a number');
    process.exit(1);
  }
  return { requestId, amountOverride: amountFlag };
}

function computeAmount(opts: {
  kind: 'full' | 'partial' | 'slow-cancel';
  amountPaidRaw: string;
  decimals: number;
  override?: string;
}): string {
  if (opts.kind === 'partial') {
    if (!opts.override) {
      throw new Error('partial refunds require --amount=<human>');
    }
    return opts.override;
  }
  const paid = BigInt(opts.amountPaidRaw);
  const raw = opts.kind === 'full' ? paid : paid / 2n;
  return formatUnits(raw, opts.decimals);
}

async function main() {
  if (!process.env.REFUND_ADMIN_KEY) {
    console.error('REFUND_ADMIN_KEY missing — refuse to process refund');
    process.exit(1);
  }
  const { requestId, amountOverride } = parseArgs();
  const supabase = getSupabaseServer();

  const { data: request, error: reqErr } = await supabase
    .from('refund_requests')
    .select('*')
    .eq('id', requestId)
    .single();

  if (reqErr || !request) {
    console.error(`refund_requests #${requestId} not found:`, reqErr?.message);
    process.exit(1);
  }
  if (request.status !== 'pending') {
    console.error(`request #${requestId} is "${request.status}", not pending — skip`);
    process.exit(1);
  }

  const { data: thread, error: thrErr } = await supabase
    .from('threads')
    .select('token_symbol, amount_paid_raw, refund_tx_hash')
    .eq('chain_id', request.chain_id)
    .eq('onchain_thread_id', request.onchain_thread_id)
    .single();

  if (thrErr || !thread) {
    console.error('parent thread not found:', thrErr?.message);
    process.exit(1);
  }

  // Idempotency across both refund paths: /api/refund and this script both
  // stamp threads.refund_tx_hash. If it's already set, this thread was paid
  // out once — never send again, regardless of refund_requests.status.
  if (thread.refund_tx_hash) {
    console.error(
      `thread ${request.onchain_thread_id} already refunded (tx ${thread.refund_tx_hash}) — refuse to double-send`,
    );
    // Reconcile the queue row so it stops showing as pending.
    await supabase
      .from('refund_requests')
      .update({ status: 'completed', refund_tx_hash: thread.refund_tx_hash })
      .eq('id', requestId);
    process.exit(1);
  }

  const tokenSymbol = thread.token_symbol as TokenSymbol;
  const tokens = getTokens(request.chain_id);
  const token = tokens[tokenSymbol];
  if (!token) {
    console.error(`token ${tokenSymbol} not configured for chain ${request.chain_id}`);
    process.exit(1);
  }

  const amountHuman = computeAmount({
    kind: request.kind,
    amountPaidRaw: thread.amount_paid_raw,
    decimals: token.decimals,
    override: amountOverride,
  });
  const reason = `request #${requestId} — ${request.kind}`;

  console.log(`Processing refund_requests #${requestId}`);
  console.log(`  to:     ${request.wallet_address}`);
  console.log(`  token:  ${tokenSymbol}`);
  console.log(`  amount: ${amountHuman}`);
  console.log(`  reason: ${reason}`);

  // Mark processing first so a concurrent run won't double-send.
  const { error: lockErr } = await supabase
    .from('refund_requests')
    .update({ status: 'processing' })
    .eq('id', requestId)
    .eq('status', 'pending');
  if (lockErr) {
    console.error('failed to lock request:', lockErr.message);
    process.exit(1);
  }

  let txHash: `0x${string}`;
  try {
    txHash = await refundThread({
      chainId: request.chain_id,
      to: request.wallet_address as `0x${string}`,
      tokenSymbol,
      amountHuman,
      reason,
    });
  } catch (e) {
    // Best-effort revert to pending so admin can retry.
    await supabase.from('refund_requests').update({ status: 'pending' }).eq('id', requestId);
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

  console.log(`✓ refunded — tx: ${txHash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
