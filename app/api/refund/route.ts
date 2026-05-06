import { NextResponse } from 'next/server';
import { refundThread } from '@/lib/orchestrator';
import { getSupabaseServer } from '@/lib/supabase';
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

  try {
    const txHash = await refundThread({
      chainId: body.chainId,
      to: body.to as Address,
      tokenSymbol: body.tokenSymbol,
      amountHuman: body.amountHuman,
      reason: body.reason,
    });

    try {
      const supabase = getSupabaseServer();
      const { error } = await supabase
        .from('threads')
        .update({ refund_tx_hash: txHash, refund_reason: body.reason })
        .eq('chain_id', body.chainId)
        .eq('onchain_thread_id', body.onchainThreadId);
      if (error) console.error('[refund] supabase update failed:', error.message);
    } catch (e) {
      console.error('[refund] supabase unavailable:', e);
    }

    return NextResponse.json({ txHash });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'refund failed' },
      { status: 502 },
    );
  }
}
