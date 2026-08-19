import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { isSupportedChain } from '@/lib/chainPolicy';

export const runtime = 'nodejs';
// Never cached. The caller is a user who has already paid and is watching this
// poll; /api/public/threads carries `revalidate = 30`, which would show them a
// finished thread up to half a minute late.
export const dynamic = 'force-dynamic';

// amount_paid_raw is the on-chain VERIFIED amount the route wrote at insert
// time (app/api/generate/stream/route.ts:133). It is the only honest source for
// a resumed receipt's price — the head price may have changed since.
// wallet_address is filtered on, never returned: handing it back turned this
// route into a map from a guessable thread id to the address that paid for it.
const COLUMNS =
  'status,tweets,topic,amount_paid_raw,total_cost_usd,token_symbol,pay_tx_hash';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainId = Number(url.searchParams.get('chainId'));
  const threadId = url.searchParams.get('threadId') ?? '';
  // Thread ids come off a single on-chain counter, so they are sequential and
  // trivially guessable. Without an owner to match, walking 1..N returned every
  // user's drafts — and, until now, the wallet that paid for each one. The
  // caller already holds this: it is the wallet that paid (lib/paidRun).
  const wallet = (url.searchParams.get('wallet') ?? '').toLowerCase();

  // lib/chainPolicy is the only allowlist in the app — never a second list here.
  if (!isSupportedChain(chainId)) {
    return NextResponse.json({ error: 'unsupported chain' }, { status: 400 });
  }
  if (!/^\d+$/.test(threadId)) {
    return NextResponse.json({ error: 'invalid threadId' }, { status: 400 });
  }
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
    return NextResponse.json({ error: 'invalid wallet' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from('threads')
      .select(COLUMNS)
      .eq('chain_id', chainId)
      .eq('onchain_thread_id', threadId)
      // Filtered in the query rather than compared afterwards: a row belonging
      // to someone else never leaves the database, and the answer for "wrong
      // owner" is the same 404 as "no such thread" — no existence oracle.
      .eq('wallet_address', wallet)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const row = data as Record<string, unknown>;
    return NextResponse.json({
      status: row.status ?? null,
      tweets: row.tweets ?? null,
      topic: row.topic ?? null,
      amountPaidRaw: row.amount_paid_raw ?? null,
      totalCostUsd: row.total_cost_usd ?? null,
      tokenSymbol: row.token_symbol ?? null,
      payTxHash: row.pay_tx_hash ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
