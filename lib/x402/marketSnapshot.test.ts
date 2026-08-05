import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  normalizeRows,
  selectCoins,
  getRows,
  __resetSnapshotCacheForTests,
  SNAPSHOT_TTL_MS,
  MAX_LIMIT,
  type CoinRow,
} from './marketSnapshot';

const RAW = [
  {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    current_price: 100,
    market_cap: 10,
    market_cap_rank: 1,
    total_volume: 5,
    price_change_percentage_24h_in_currency: 1.5,
    price_change_percentage_7d_in_currency: -2,
  },
  { id: 'celo', symbol: 'CELO', name: 'Celo', current_price: 0.5, market_cap_rank: 100 },
];

function row(id: string, symbol: string): CoinRow {
  return {
    id,
    symbol,
    name: id,
    priceUsd: 1,
    change24hPct: null,
    change7dPct: null,
    marketCapUsd: null,
    marketCapRank: null,
    volume24hUsd: null,
  };
}

describe('normalizeRows', () => {
  it('lowercases symbols and nulls out missing numbers', () => {
    const rows = normalizeRows(RAW);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: 'bitcoin', symbol: 'btc', priceUsd: 100, change24hPct: 1.5 });
    expect(rows[1]).toMatchObject({ id: 'celo', symbol: 'celo', volume24hUsd: null, change7dPct: null });
  });

  it('drops junk instead of throwing', () => {
    expect(normalizeRows(null)).toEqual([]);
    expect(normalizeRows([null, 'x', { symbol: 'no-id' }])).toEqual([]);
  });
});

describe('selectCoins', () => {
  const rows = [row('bitcoin', 'btc'), row('celo', 'celo'), row('ethereum', 'eth')];

  it('defaults to the first `limit` rows', () => {
    expect(selectCoins(rows, undefined, 2).map((r) => r.id)).toEqual(['bitcoin', 'celo']);
  });

  it('matches on id or symbol, case-insensitively', () => {
    expect(selectCoins(rows, ['CELO'], 10).map((r) => r.id)).toEqual(['celo']);
    expect(selectCoins(rows, ['eth', 'bitcoin'], 10).map((r) => r.id)).toEqual(['bitcoin', 'ethereum']);
  });

  it('returns nothing for an unknown coin so the route can refuse the sale', () => {
    expect(selectCoins(rows, ['nope'], 10)).toEqual([]);
  });

  it('caps the row count', () => {
    expect(selectCoins(rows, undefined, 999)).toHaveLength(Math.min(rows.length, MAX_LIMIT));
    expect(selectCoins(rows, undefined, 0)).toHaveLength(1);
  });
});

describe('getRows', () => {
  beforeEach(() => {
    __resetSnapshotCacheForTests();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    __resetSnapshotCacheForTests();
  });

  function mockFetch(rows: unknown, ok = true): ReturnType<typeof vi.fn> {
    const f = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => rows });
    vi.stubGlobal('fetch', f);
    return f;
  }

  // A refresh issues two requests (top-250 + the pinned Celo ids); count the
  // top-250 one so the assertions stay about refreshes, not request shape.
  function refreshes(f: ReturnType<typeof vi.fn>): number {
    return f.mock.calls.filter((c) => String(c[0]).includes('order=market_cap_desc')).length;
  }

  it('serves the cache within the TTL — one upstream call for many sales', async () => {
    const f = mockFetch(RAW);
    await getRows();
    await getRows();
    await getRows();
    expect(refreshes(f)).toBe(1);
  });

  it('refetches once the TTL has passed', async () => {
    const f = mockFetch(RAW);
    const t0 = Date.now();
    await getRows(t0);
    await getRows(t0 + SNAPSHOT_TTL_MS + 1);
    expect(refreshes(f)).toBe(2);
  });

  it('collapses a concurrent burst on a cold cache into one upstream call', async () => {
    const f = mockFetch(RAW);
    await Promise.all([getRows(), getRows(), getRows(), getRows()]);
    expect(refreshes(f)).toBe(1);
  });

  it('serves stale rows when the refresh fails rather than failing the sale', async () => {
    mockFetch(RAW);
    const t0 = Date.now();
    await getRows(t0);

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const rows = await getRows(t0 + SNAPSHOT_TTL_MS + 1);
    expect(rows.map((r) => r.id)).toEqual(['bitcoin', 'celo']);
  });

  it('throws on a cold cache so the route can 502 without charging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(getRows()).rejects.toThrow('network down');
  });

  it('treats an empty upstream body as a failure', async () => {
    mockFetch([]);
    await expect(getRows()).rejects.toThrow('no rows');
  });
});
