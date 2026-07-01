import { retryOnce } from './retry';

// DefiLlama — free, no API key. Adds the one signal CoinGecko can't give a
// researcher: on-chain capital. For a DeFi token, TVL (and mcap/TVL) says
// whether the valuation is backed by real deposits. For a market recap, total
// DeFi TVL + stablecoin supply is the macro backdrop the day plays out against.
//
// Pure fetches, no emit, no x402 settle (free), soft-fail to null so a
// DefiLlama outage never sinks a thread — grounding is additive, never required.

const LLAMA_BASE = 'https://api.llama.fi';
const STABLE_BASE = 'https://stablecoins.llama.fi';

export interface ProtocolTvl {
  name: string;
  tvlUsd: number;
  change1dPct: number | null;
  change7dPct: number | null;
  category: string | null;
}

interface ProtocolRow {
  name?: string;
  symbol?: string;
  tvl?: number;
  change_1d?: number | null;
  change_7d?: number | null;
  category?: string;
}

// The /protocols list is ~thousands of rows and rarely changes minute-to-
// minute. Memoise it per process (Fluid Compute reuses instances) so a burst
// of token threads doesn't refetch the whole catalogue each time.
const PROTOCOLS_TTL_MS = 10 * 60 * 1000;
let protocolsCache: { at: number; rows: ProtocolRow[] } | null = null;

async function getProtocols(): Promise<ProtocolRow[]> {
  if (protocolsCache && Date.now() - protocolsCache.at < PROTOCOLS_TTL_MS) {
    return protocolsCache.rows;
  }
  const rows = await retryOnce(async () => {
    const res = await fetch(`${LLAMA_BASE}/protocols`);
    if (!res.ok) throw new Error(`DefiLlama ${res.status}`);
    const j = (await res.json()) as ProtocolRow[];
    if (!Array.isArray(j)) throw new Error('DefiLlama /protocols shape');
    return j;
  });
  protocolsCache = { at: Date.now(), rows };
  return rows;
}

// Resolve a token ticker (no leading $) to its DefiLlama protocol, if it is
// one. Most tokens aren't protocols (BTC, memecoins) — returns null then, which
// is a normal, non-error outcome the caller treats as "no TVL context".
export async function fetchProtocolTvl(ticker: string): Promise<ProtocolTvl | null> {
  const sym = ticker.replace(/^\$+/, '').trim().toUpperCase();
  if (!sym) return null;
  let rows: ProtocolRow[];
  try {
    rows = await getProtocols();
  } catch {
    return null; // soft: no TVL context rather than a failed thread
  }
  // A ticker can map to several protocol rows; the mainnet one carries the
  // most TVL, so pick the largest.
  const matches = rows.filter(
    (r) => (r.symbol ?? '').toUpperCase() === sym && typeof r.tvl === 'number' && r.tvl! > 0,
  );
  if (matches.length === 0) return null;
  const best = matches.reduce((a, b) => ((b.tvl ?? 0) > (a.tvl ?? 0) ? b : a));
  return {
    name: best.name ?? sym,
    tvlUsd: best.tvl!,
    change1dPct: best.change_1d ?? null,
    change7dPct: best.change_7d ?? null,
    category: best.category ?? null,
  };
}

function usdCompact(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

function signedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

// One-line TVL context for the token prompt. mcap/TVL is a classic DeFi
// valuation ratio: a high ratio means the market prices the token well above
// the capital actually deposited in the protocol.
export function summarizeProtocolTvl(tvl: ProtocolTvl | null, mcapUsd: number | null): string | null {
  if (!tvl) return null;
  const head = [`TVL ${usdCompact(tvl.tvlUsd)}`];
  if (tvl.category) head.push(tvl.category);
  const parts = [`${head.join(', ')} (${tvl.name} on DefiLlama)`];
  if (typeof mcapUsd === 'number' && mcapUsd > 0) {
    parts.push(`mcap/TVL ${(mcapUsd / tvl.tvlUsd).toFixed(2)}`);
  }
  if (tvl.change7dPct !== null) parts.push(`TVL 7d ${signedPct(tvl.change7dPct)}`);
  return parts.join(', ');
}

interface ChainRow {
  name?: string;
  tvl?: number;
}

// Macro backdrop for Daily Recap: total DeFi TVL (with the leading chain) and
// total stablecoin supply. Both are soft — either can be null and the recap
// still stands on its market + news grounding.
export async function fetchDefiOverview(): Promise<string | null> {
  const lines: string[] = [];

  try {
    const chains = await retryOnce(async () => {
      const res = await fetch(`${LLAMA_BASE}/v2/chains`);
      if (!res.ok) throw new Error(`DefiLlama ${res.status}`);
      const j = (await res.json()) as ChainRow[];
      if (!Array.isArray(j)) throw new Error('DefiLlama /v2/chains shape');
      return j;
    });
    const valid = chains.filter((c) => typeof c.tvl === 'number' && c.tvl! > 0);
    const total = valid.reduce((sum, c) => sum + (c.tvl ?? 0), 0);
    if (total > 0) {
      const top = valid.reduce((a, b) => ((b.tvl ?? 0) > (a.tvl ?? 0) ? b : a));
      lines.push(
        `DeFi TVL: ${usdCompact(total)} across all chains (top chain ${top.name ?? 'unknown'} ${usdCompact(top.tvl ?? 0)})`,
      );
    }
  } catch {
    // no DeFi TVL line — the recap still has market + news grounding
  }

  try {
    const total = await retryOnce(async () => {
      const res = await fetch(`${STABLE_BASE}/stablecoins?includePrices=false`);
      if (!res.ok) throw new Error(`DefiLlama ${res.status}`);
      const j = (await res.json()) as {
        peggedAssets?: Array<{ circulating?: { peggedUSD?: number } }>;
      };
      const assets = j.peggedAssets;
      if (!Array.isArray(assets)) throw new Error('DefiLlama /stablecoins shape');
      return assets.reduce((sum, a) => sum + (a.circulating?.peggedUSD ?? 0), 0);
    });
    if (total > 0) lines.push(`Stablecoin supply: ${usdCompact(total)}`);
  } catch {
    // no stablecoin line
  }

  return lines.length ? lines.join('\n') : null;
}
