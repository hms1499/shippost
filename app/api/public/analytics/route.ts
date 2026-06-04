import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { aggregateAgentSpend } from '@/lib/agentSpend';

export const runtime = 'nodejs';
export const revalidate = 30;

const MAINNET_CHAIN_ID = 42220;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainIdParam = url.searchParams.get('chainId');
  const chainId = chainIdParam ? Number(chainIdParam) : MAINNET_CHAIN_ID;

  try {
    const supabase = getSupabaseServer();

    const { count: threads } = await supabase
      .from('threads')
      .select('*', { count: 'exact', head: true })
      .eq('chain_id', chainId)
      .eq('status', 'completed');

    const { data: walletRows } = await supabase
      .from('threads')
      .select('wallet_address')
      .eq('chain_id', chainId)
      .eq('status', 'completed');

    const walletCounts = new Map<string, number>();
    for (const r of walletRows ?? []) {
      walletCounts.set(r.wallet_address, (walletCounts.get(r.wallet_address) ?? 0) + 1);
    }
    const repeatUsers = Array.from(walletCounts.values()).filter((n) => n > 1).length;

    const { data: costRows } = await supabase
      .from('threads')
      .select(
        'total_cost_usd,groq_tx_hash,serper_tx_hash,coingecko_tx_hash,fact_check_tx_hash,token_symbol',
      )
      .eq('chain_id', chainId)
      .eq('status', 'completed');

    const agent = aggregateAgentSpend(costRows ?? []);

    const volumeUsd = (threads ?? 0) * 0.05;

    return NextResponse.json({
      threads: threads ?? 0,
      uniqueWallets: walletCounts.size,
      volumeUsd: volumeUsd.toFixed(2),
      x402Count: agent.x402CallCount,
      agentSpendUsd: agent.agentSpendUsd,
      byToken: agent.byToken,
      repeatUsers,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
