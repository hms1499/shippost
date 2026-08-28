import type { Hex } from 'viem';
import { retryOnce } from './retry';
import { alertOps } from '@/lib/alert';
import type { PipelineContext, PipelineEvent } from './types';

// CoinGecko is the one grounding source we call with no credentials at all.
// Unset stays a supported state — it is what prod runs on today — but the
// keyless public tier throttles at a handful of requests a minute, so market
// data is the first grounding to disappear the moment two people generate at
// once. A demo key is free and raises that ceiling; the plan decides both the
// host and the header name, and getting that pair wrong 401s.
const CG_DEMO_BASE = 'https://api.coingecko.com/api/v3';
const CG_PRO_BASE = 'https://pro-api.coingecko.com/api/v3';
const NULL_TX: Hex = '0x0';

// Alert once per process. A bad key fails every single call, and one broken
// deploy must not turn into a thousand identical pages.
let authAlerted = false;

/** Every CoinGecko request goes through here so the key can never be applied to
 *  three call sites and forgotten on the fourth. */
async function cgFetch(path: string): Promise<Response> {
  const key = process.env.COINGECKO_API_KEY?.trim();
  const pro = process.env.COINGECKO_API_PLAN?.trim().toLowerCase() === 'pro';
  const base = key && pro ? CG_PRO_BASE : CG_DEMO_BASE;
  const headers: Record<string, string> = key
    ? { [pro ? 'x-cg-pro-api-key' : 'x-cg-demo-api-key']: key }
    : {};

  const res = await fetch(`${base}${path}`, key ? { headers } : undefined);

  // A rejected key must not look like "this token has no market data". Callers
  // soft-fail on anything non-ok, so without this line a wrong key degrades
  // every thread silently and indefinitely — the failure mode this codebase
  // keeps getting bitten by.
  if (key && (res.status === 401 || res.status === 403) && !authAlerted) {
    authAlerted = true;
    console.error(`[coingecko] key rejected (${res.status}) — market data is off until fixed`);
    void alertOps('CoinGecko key rejected — every thread is shipping without market data', {
      status: res.status,
      plan: pro ? 'pro' : 'demo',
    });
  }
  return res;
}

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

// Exported for the grounding audit: an empty market_snippet on a free-text mode
// means "the event named no token", not "CoinGecko failed", and the audit can
// only tell those apart by applying this exact rule. A copy of the regex there
// would drift and start reporting normal runs as degraded.
export function extractSymbol(text: string): string | null {
  const cashTag = text.match(/\$([A-Za-z]{2,6})\b/);
  if (cashTag) return cashTag[1].toLowerCase();
  return null;
}

async function resolveCoinId(symbol: string): Promise<string | null> {
  const res = await cgFetch(`/search?query=${encodeURIComponent(symbol)}`);
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
    const res = await cgFetch(`/coins/markets?vs_currency=usd&ids=${id}&price_change_percentage=24h%2C7d%2C30d`);
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
    const res = await cgFetch(
      '/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&price_change_percentage=24h',
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
    const res = await cgFetch('/search/trending');
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
  ctx: PipelineContext,
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
    tokenSymbol: ctx.tokenSymbol,
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
    tokenSymbol: ctx.tokenSymbol,
  });
  return result;
}
