import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { DEFAULT_CHAIN_ID } from '@/lib/chainPolicy';

export const runtime = 'nodejs';
export const revalidate = 30;

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const wallet = url.searchParams.get('wallet')?.toLowerCase();
  const chainIdParam = url.searchParams.get('chainId');
  // The fallback follows the deployment's own chain policy — a hardcoded id
  // here answered every param-less call with Celo's numbers once Base became
  // the default chain.
  const chainId = chainIdParam ? Number(chainIdParam) : DEFAULT_CHAIN_ID;
  const limit = Math.min(
    Math.max(Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  try {
    // What a run *is* — id, mode, token, price, status — is on chain already
    // and safe to list. What the user wrote is not: an unscoped call returned
    // fifty strangers' topics and finished threads in one request, no address
    // needed. Content ships only when the caller names the wallet it belongs
    // to, which is what /history does.
    const PUBLIC_COLUMNS =
      'chain_id,onchain_thread_id,wallet_address,mode,token_symbol,pay_tx_hash,total_cost_usd,status,created_at';
    const OWNER_COLUMNS = `${PUBLIC_COLUMNS},topic,tweets`;

    const supabase = getSupabaseServer();
    let query = supabase
      .from('threads')
      .select(wallet ? OWNER_COLUMNS : PUBLIC_COLUMNS)
      .eq('chain_id', chainId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (wallet) query = query.eq('wallet_address', wallet);

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ threads: data ?? [] });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
