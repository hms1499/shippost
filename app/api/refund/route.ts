import { NextResponse } from 'next/server';
import { refundThread } from '@/lib/agent/orchestrator';
import { getSupabaseServer } from '@/lib/supabase';
import { alertOps } from '@/lib/alert';
import type { Address } from 'viem';

interface RefundRequest {
  chainId: number;
  onchainThreadId: string;
  to: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  amountHuman: string;
  reason: string;
}

export const runtime = 'nodejs';

const ALLOWED_TOKENS = ['cUSD', 'USDT', 'USDC'] as const;

function validate(b: Partial<RefundRequest>): string | null {
  if (typeof b.chainId !== 'number') return 'chainId required';
  if (!b.onchainThreadId) return 'onchainThreadId required';
  if (!b.to || !/^0x[a-fA-F0-9]{40}$/.test(b.to)) return 'to must be a 0x address';
  if (!b.tokenSymbol || !ALLOWED_TOKENS.includes(b.tokenSymbol)) return 'invalid tokenSymbol';
  if (!b.amountHuman || !/^\d+(\.\d+)?$/.test(b.amountHuman)) return 'amountHuman must be a decimal string';
  if (!b.reason?.trim()) return 'reason required';
  return null;
}

export async function POST(req: Request) {
  const expected = process.env.REFUND_ADMIN_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'refund admin not configured' }, { status: 503 });
  }
  const supplied = req.headers.get('x-admin-key');
  if (supplied !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: RefundRequest;
  try {
    body = (await req.json()) as RefundRequest;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const err = validate(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  // Idempotency across both refund paths: refuse if this thread was already
  // paid out (stamped by either this endpoint or `pnpm refund:process`).
  try {
    const supabase = getSupabaseServer();
    const { data: existing, error: lookErr } = await supabase
      .from('threads')
      .select('refund_tx_hash')
      .eq('chain_id', body.chainId)
      .eq('onchain_thread_id', body.onchainThreadId)
      .maybeSingle();
    if (lookErr) {
      return NextResponse.json({ error: 'refund precheck failed' }, { status: 502 });
    }
    if (existing?.refund_tx_hash) {
      return NextResponse.json(
        { error: 'already refunded', txHash: existing.refund_tx_hash },
        { status: 409 },
      );
    }
  } catch {
    // No Supabase = no audit trail = no safe idempotency. Refuse rather than
    // risk a blind double-send.
    return NextResponse.json({ error: 'refund audit store unavailable' }, { status: 503 });
  }

  try {
    const txHash = await refundThread({
      chainId: body.chainId,
      onchainThreadId: body.onchainThreadId,
      to: body.to as Address,
      tokenSymbol: body.tokenSymbol,
      amountHuman: body.amountHuman,
      reason: body.reason,
    });

    // Money has left the wallet. If we can't stamp refund_tx_hash, the DB no
    // longer knows this thread was paid out — the cross-path idempotency guard
    // goes blind and a retry could double-send. This is a page-a-human event.
    try {
      const supabase = getSupabaseServer();
      const { error } = await supabase
        .from('threads')
        .update({ refund_tx_hash: txHash, refund_reason: body.reason })
        .eq('chain_id', body.chainId)
        .eq('onchain_thread_id', body.onchainThreadId);
      if (error) {
        console.error('[refund] supabase update failed:', error.message);
        await alertOps('refund SENT but DB not stamped — double-send risk', {
          chainId: body.chainId,
          onchainThreadId: body.onchainThreadId,
          txHash,
          to: body.to,
          error: error.message,
        });
      }
    } catch (e) {
      console.error('[refund] supabase unavailable:', e);
      await alertOps('refund SENT but DB not stamped — double-send risk', {
        chainId: body.chainId,
        onchainThreadId: body.onchainThreadId,
        txHash,
        to: body.to,
        error: e instanceof Error ? e.message : String(e),
      });
    }

    return NextResponse.json({ txHash });
  } catch (e: unknown) {
    // Send failed: the transfer may or may not have broadcast, so on-chain state
    // is unknown. Verify before any retry.
    const message = e instanceof Error ? e.message : 'refund failed';
    await alertOps('refund send FAILED — verify on-chain before retry', {
      chainId: body.chainId,
      onchainThreadId: body.onchainThreadId,
      to: body.to,
      error: message,
    });
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
