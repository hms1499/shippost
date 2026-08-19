import { NextResponse } from 'next/server';
import { formatUnits } from 'viem';
import { getSupabaseServer } from '@/lib/supabase';
import { aggregateAgentSpend } from '@/lib/agentSpend';
import { getTokens, type TokenSymbol } from '@/lib/tokens';
import { DEFAULT_CHAIN_ID } from '@/lib/chainPolicy';

export const runtime = 'nodejs';
export const revalidate = 30;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const chainIdParam = url.searchParams.get('chainId');
  // The fallback follows the deployment's own chain policy — a hardcoded id
  // here answered every param-less call with Celo's numbers once Base became
  // the default chain.
  const chainId = chainIdParam ? Number(chainIdParam) : DEFAULT_CHAIN_ID;

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
        'total_cost_usd,groq_tx_hash,serper_tx_hash,coingecko_tx_hash,fact_check_tx_hash,token_symbol,amount_paid_raw',
      )
      .eq('chain_id', chainId)
      .eq('status', 'completed');

    const agent = aggregateAgentSpend(costRows ?? []);

    // Sum what each thread actually paid. A constant per thread was correct
    // only while the price was fixed; setPrice means old and new threads carry
    // different amounts, and amount_paid_raw is the verified on-chain value.
    const tokens = getTokens(chainId);
    let volumeUsd = 0;
    for (const r of costRows ?? []) {
      const t = tokens[r.token_symbol as TokenSymbol];
      if (!t || !r.amount_paid_raw) continue;
      volumeUsd += Number(formatUnits(BigInt(r.amount_paid_raw), t.decimals));
    }

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
