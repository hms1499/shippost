import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';

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
    .select('wallet_address, status')
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
