import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';

const KINDS = ['full', 'partial', 'slow-cancel'] as const;
type Kind = (typeof KINDS)[number];

interface Body {
  chainId: number;
  onchainThreadId: string;
  walletAddress: string;
  kind: Kind;
}

function validate(b: Partial<Body>): string | null {
  if (typeof b.chainId !== 'number') return 'chainId required';
  if (!b.onchainThreadId) return 'onchainThreadId required';
  if (!b.walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(b.walletAddress))
    return 'walletAddress must be a 0x address';
  if (!b.kind || !KINDS.includes(b.kind)) return 'kind must be full|partial|slow-cancel';
  return null;
}

export async function POST(req: Request) {
  const rl = await checkRateLimit(getClientIp(req), 'refund-request');
  if (!rl.success) {
    return NextResponse.json(
      { error: 'rate limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.reset - Date.now()) / 1000)) },
      },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 });
  }
  const err = validate(body);
  if (err) return NextResponse.json({ error: err }, { status: 400 });

  const wallet = body.walletAddress.toLowerCase();
  const supabase = getSupabaseServer();

  // Verify the thread exists and the wallet actually paid for it. Stops randos
  // queueing refunds against thread IDs they didn't pay for.
  const { data: thread, error: threadErr } = await supabase
    .from('threads')
    .select('wallet_address, status, refund_tx_hash')
    .eq('chain_id', body.chainId)
    .eq('onchain_thread_id', body.onchainThreadId)
    .maybeSingle();

  if (threadErr) {
    return NextResponse.json({ error: 'lookup failed' }, { status: 502 });
  }
  if (!thread) {
    return NextResponse.json({ error: 'thread not found' }, { status: 404 });
  }
  if (thread.wallet_address.toLowerCase() !== wallet) {
    return NextResponse.json({ error: 'wallet did not pay for this thread' }, { status: 403 });
  }
  // Already settled — don't let users queue requests against a refunded
  // thread. Keeps the operator queue clean and removes the double-processing
  // confusion the cross-path idempotency guard also defends against.
  if (thread.refund_tx_hash) {
    return NextResponse.json(
      { error: 'thread already refunded', txHash: thread.refund_tx_hash },
      { status: 409 },
    );
  }
  // Defense in depth: a 'slow-cancel' refund means "the run never finished".
  // The current client no longer sends it, but a stale client might — and the
  // server's deadline can complete a run the client gave up on. Never queue a
  // cancel-refund against a thread that actually delivered. ('partial' stays
  // valid: a completed-but-degraded thread is legitimately partially refundable.)
  if (body.kind === 'slow-cancel' && thread.status === 'completed') {
    return NextResponse.json(
      { error: 'thread already completed — not eligible for a cancel refund' },
      { status: 409 },
    );
  }

  // Upsert: if user clicks twice, return the existing pending row instead of erroring.
  const { data, error } = await supabase
    .from('refund_requests')
    .upsert(
      {
        chain_id: body.chainId,
        onchain_thread_id: body.onchainThreadId,
        wallet_address: wallet,
        kind: body.kind,
      },
      { onConflict: 'chain_id,onchain_thread_id,wallet_address,kind', ignoreDuplicates: false },
    )
    .select('id, status, created_at')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }

  return NextResponse.json({
    requestId: data.id,
    status: data.status,
    message: 'Refund request received. Operator will process within 24h.',
  });
}
