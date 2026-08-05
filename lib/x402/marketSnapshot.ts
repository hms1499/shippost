// The data /api/x402/data sells: a market snapshot the agent pipeline already
// relies on (lib/pipeline/coingeckoStep.ts reads the same CoinGecko endpoint).
//
// One upstream call serves every buyer. The snapshot is fetched for a fixed
// top-N set and cached; a caller's `coins` filter is applied to the cached rows
// rather than issuing another upstream request, so buyers never fan out into
// calls against CoinGecko — at a 60s TTL the upstream sees at most 1,440
// calls/day.

const CG_BASE = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&price_change_percentage=24h%2C7d';

// Top 250 by market cap...
const CG_MARKETS = `${CG_BASE}&order=market_cap_desc&per_page=250&page=1`;

// ...plus the Celo set, pinned by id. CELO and cUSD both fall outside the top
// 250, and an endpoint running on Celo that cannot quote CELO is indefensible.
export const PINNED_IDS = ['celo', 'celo-dollar'];
const CG_PINNED = `${CG_BASE}&ids=${PINNED_IDS.join('%2C')}`;

export const SNAPSHOT_TTL_MS = 60_000;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export interface CoinRow {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  change24hPct: number | null;
  change7dPct: number | null;
  marketCapUsd: number | null;
  marketCapRank: number | null;
  volume24hUsd: number | null;
}

export interface Snapshot {
  asOf: string;
  source: 'coingecko';
  coins: CoinRow[];
}

interface RawRow {
  id?: string;
  symbol?: string;
  name?: string;
  current_price?: number;
  market_cap?: number;
  market_cap_rank?: number;
  total_volume?: number;
  price_change_percentage_24h_in_currency?: number;
  price_change_percentage_7d_in_currency?: number;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function normalizeRows(raw: unknown): CoinRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is RawRow => typeof r === 'object' && r !== null)
    .map((r) => ({
      id: String(r.id ?? ''),
      symbol: String(r.symbol ?? '').toLowerCase(),
      name: String(r.name ?? ''),
      priceUsd: num(r.current_price),
      change24hPct: num(r.price_change_percentage_24h_in_currency),
      change7dPct: num(r.price_change_percentage_7d_in_currency),
      marketCapUsd: num(r.market_cap),
      marketCapRank: num(r.market_cap_rank),
      volume24hUsd: num(r.total_volume),
    }))
    .filter((r) => r.id !== '');
}

/** Filter a cached snapshot by coin id or symbol, then cap the row count. */
export function selectCoins(rows: CoinRow[], coins: string[] | undefined, limit: number): CoinRow[] {
  const capped = Math.min(Math.max(1, limit), MAX_LIMIT);
  if (!coins || coins.length === 0) return rows.slice(0, capped);
  const want = new Set(coins.map((c) => c.trim().toLowerCase()).filter(Boolean));
  return rows.filter((r) => want.has(r.id) || want.has(r.symbol)).slice(0, capped);
}

let cached: { at: number; rows: CoinRow[] } | null = null;
let inflight: Promise<CoinRow[]> | null = null;

/**
 * Cached top-50 rows. Concurrent callers during a refresh share one upstream
 * request — without that, a burst of paid requests arriving on a cold cache
 * would fan out into a burst against CoinGecko.
 */
export async function getRows(now: number = Date.now()): Promise<CoinRow[]> {
  if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached.rows;
  if (inflight) return inflight;

  inflight = (async () => {
    const get = async (url: string): Promise<CoinRow[]> => {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`coingecko ${res.status}`);
      return normalizeRows(await res.json());
    };
    // The pinned call is allowed to fail on its own: losing CELO is worse than
    // losing the whole snapshot, but not worth failing the top-250 over.
    const [top, pinned] = await Promise.all([get(CG_MARKETS), get(CG_PINNED).catch(() => [])]);
    if (top.length === 0) throw new Error('coingecko returned no rows');
    const seen = new Set(top.map((r) => r.id));
    const rows = [...top, ...pinned.filter((r) => !seen.has(r.id))];
    cached = { at: Date.now(), rows };
    return rows;
  })()
    .catch((e: unknown) => {
      // A stale snapshot beats a failed sale: the buyer still gets real data
      // and the payment still settles. Only a cold cache surfaces the error.
      if (cached) return cached.rows;
      throw e;
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function __resetSnapshotCacheForTests(): void {
  cached = null;
  inflight = null;
}
