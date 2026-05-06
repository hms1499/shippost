import type { Hex } from 'viem';
import type { PipelineContext, PipelineEvent } from './types';

const CG_BASE = 'https://api.coingecko.com/api/v3';
const NULL_TX: Hex = '0x0';

export interface CoinGeckoResult {
  symbol: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  marketCapUsd: number | null;
}

function extractSymbol(text: string): string | null {
  const cashTag = text.match(/\$([A-Za-z]{2,6})\b/);
  if (cashTag) return cashTag[1].toLowerCase();
  return null;
}

async function resolveCoinId(symbol: string): Promise<string | null> {
  const res = await fetch(`${CG_BASE}/search?query=${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  const j = (await res.json()) as { coins?: Array<{ id: string; symbol: string }> };
  const hit = j.coins?.find((c) => c.symbol.toLowerCase() === symbol.toLowerCase());
  return hit?.id ?? null;
}

const EMPTY: CoinGeckoResult = {
  symbol: null,
  priceUsd: null,
  change24hPct: null,
  marketCapUsd: null,
};

export async function runCoinGeckoStep(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<CoinGeckoResult> {
  emit({ type: 'step_started', step: 'coingecko' });

  const sym = extractSymbol(ctx.topic);
  if (!sym) {
    emit({ type: 'step_output', step: 'coingecko', output: EMPTY });
    emit({
      type: 'step_settled',
      step: 'coingecko',
      txHash: NULL_TX,
      costAmount: '0.000',
      tokenSymbol: 'cUSD',
    });
    return EMPTY;
  }

  try {
    const id = await resolveCoinId(sym);
    if (!id) {
      const r: CoinGeckoResult = { ...EMPTY, symbol: sym.toUpperCase() };
      emit({ type: 'step_output', step: 'coingecko', output: r });
      emit({
        type: 'step_settled',
        step: 'coingecko',
        txHash: NULL_TX,
        costAmount: '0.000',
        tokenSymbol: 'cUSD',
      });
      return r;
    }
    const res = await fetch(
      `${CG_BASE}/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`,
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const j = (await res.json()) as Record<
      string,
      { usd?: number; usd_24h_change?: number; usd_market_cap?: number }
    >;
    const entry = j[id];
    const result: CoinGeckoResult = {
      symbol: sym.toUpperCase(),
      priceUsd: entry?.usd ?? null,
      change24hPct: entry?.usd_24h_change ?? null,
      marketCapUsd: entry?.usd_market_cap ?? null,
    };
    emit({ type: 'step_output', step: 'coingecko', output: result });
    emit({
      type: 'step_settled',
      step: 'coingecko',
      txHash: NULL_TX,
      costAmount: '0.000',
      tokenSymbol: 'cUSD',
    });
    return result;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'coingecko failed';
    emit({ type: 'step_failed', step: 'coingecko', error: msg });
    throw e;
  }
}
