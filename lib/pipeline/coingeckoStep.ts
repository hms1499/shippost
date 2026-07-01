import type { Hex } from 'viem';
import { retryOnce } from './retry';
import type { PipelineContext, PipelineEvent } from './types';

const CG_BASE = 'https://api.coingecko.com/api/v3';
const NULL_TX: Hex = '0x0';

export interface CoinGeckoResult {
  symbol: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  change30dPct: number | null;
  marketCapUsd: number | null;
  marketCapRank: number | null;
  volume24hUsd: number | null;
  circulatingSupply: number | null;
  maxSupply: number | null; // null = uncapped emission
  athChangePct: number | null; // negative = trading below all-time high
}

// One /coins/markets row — the fields we read for a single-token snapshot.
interface MarketDetailRow {
  current_price?: number;
  market_cap?: number;
  market_cap_rank?: number;
  total_volume?: number;
  circulating_supply?: number;
  max_supply?: number | null;
  ath_change_percentage?: number;
  price_change_percentage_24h?: number;
  price_change_percentage_24h_in_currency?: number;
  price_change_percentage_7d_in_currency?: number;
  price_change_percentage_30d_in_currency?: number;
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
  change7dPct: null,
  change30dPct: null,
  marketCapUsd: null,
  marketCapRank: null,
  volume24hUsd: null,
  circulatingSupply: null,
  maxSupply: null,
  athChangePct: null,
};

// Pure CoinGecko lookup — no emit. Returns EMPTY when no $cashtag is found or
// the coin can't be resolved. Used by the paid step and the free preview.
// Uses /coins/markets (one call, free, no key) to pull a researcher-grade
// snapshot: multi-window momentum, liquidity, dilution headroom, ATH drawdown.
export async function fetchCoinGecko(topicText: string): Promise<CoinGeckoResult> {
  const sym = extractSymbol(topicText);
  if (!sym) return EMPTY;
  const id = await resolveCoinId(sym);
  if (!id) return { ...EMPTY, symbol: sym.toUpperCase() };
  // No x402 settle in this step, so retrying the fetch is fully safe.
  const entry = await retryOnce(async () => {
    const res = await fetch(
      `${CG_BASE}/coins/markets?vs_currency=usd&ids=${id}&price_change_percentage=24h%2C7d%2C30d`,
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const j = (await res.json()) as MarketDetailRow[];
    return Array.isArray(j) ? j[0] : undefined;
  });
  if (!entry) return { ...EMPTY, symbol: sym.toUpperCase() };
  return {
    symbol: sym.toUpperCase(),
    priceUsd: entry.current_price ?? null,
    change24hPct:
      entry.price_change_percentage_24h_in_currency ?? entry.price_change_percentage_24h ?? null,
    change7dPct: entry.price_change_percentage_7d_in_currency ?? null,
    change30dPct: entry.price_change_percentage_30d_in_currency ?? null,
    marketCapUsd: entry.market_cap ?? null,
    marketCapRank: entry.market_cap_rank ?? null,
    volume24hUsd: entry.total_volume ?? null,
    circulatingSupply: entry.circulating_supply ?? null,
    maxSupply: entry.max_supply ?? null,
    athChangePct: entry.ath_change_percentage ?? null,
  };
}

interface MarketRow {
  symbol?: string;
  current_price?: number;
  price_change_percentage_24h?: number;
}

function fmtUsd(p: number): string {
  if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toPrecision(3);
}

// Whole-market snapshot for Daily Recap (mode 3) — no $cashtag involved.
// Top-10 by market cap with 24h change, plus trending searches as garnish.
// Free CoinGecko endpoints, no x402 settle, so retrying is fully safe.
export async function fetchMarketOverview(): Promise<string | null> {
  const rows = await retryOnce(async () => {
    const res = await fetch(
      `${CG_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&price_change_percentage=24h`,
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    return (await res.json()) as MarketRow[];
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const lines = rows
    .filter((r) => r.symbol && typeof r.current_price === 'number')
    .map((r) => {
      const chg = r.price_change_percentage_24h;
      const chgStr =
        typeof chg === 'number' ? ` (${chg >= 0 ? '+' : ''}${chg.toFixed(1)}% 24h)` : '';
      return `${r.symbol!.toUpperCase()} $${fmtUsd(r.current_price!)}${chgStr}`;
    });
  if (lines.length === 0) return null;

  // Trending is garnish — a failure here must not sink the snapshot.
  let trending: string[] = [];
  try {
    const res = await fetch(`${CG_BASE}/search/trending`);
    if (res.ok) {
      const j = (await res.json()) as { coins?: Array<{ item?: { symbol?: string } }> };
      trending = (j.coins ?? [])
        .map((c) => c.item?.symbol?.toUpperCase())
        .filter((s): s is string => Boolean(s))
        .slice(0, 5);
    }
  } catch {
    // snapshot still stands without trending
  }

  const blocks = [`Top 10 by market cap (price, 24h change):\n${lines.join('\n')}`];
  if (trending.length) blocks.push(`Trending searches: ${trending.join(', ')}`);
  return blocks.join('\n');
}

// Same emit lifecycle as runCoinGeckoStep (step name 'coingecko', free, no
// settle) so the UI and cost accounting treat it identically.
export async function runMarketOverviewStep(
  _ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<string | null> {
  emit({ type: 'step_started', step: 'coingecko' });

  let snippet: string | null;
  try {
    snippet = await fetchMarketOverview();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'coingecko failed';
    emit({ type: 'step_failed', step: 'coingecko', error: msg });
    throw e;
  }

  emit({ type: 'step_output', step: 'coingecko', output: snippet });
  emit({
    type: 'step_settled',
    step: 'coingecko',
    txHash: NULL_TX,
    costAmount: '0.000',
    tokenSymbol: 'cUSD',
  });
  return snippet;
}

export async function runCoinGeckoStep(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<CoinGeckoResult> {
  emit({ type: 'step_started', step: 'coingecko' });

  let result: CoinGeckoResult;
  try {
    result = await fetchCoinGecko(ctx.topic);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'coingecko failed';
    emit({ type: 'step_failed', step: 'coingecko', error: msg });
    throw e;
  }

  emit({ type: 'step_output', step: 'coingecko', output: result });
  emit({
    type: 'step_settled',
    step: 'coingecko',
    txHash: NULL_TX,
    costAmount: '0.000',
    tokenSymbol: 'cUSD',
  });
  return result;
}
