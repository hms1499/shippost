import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCoinGecko', () => {
  it('returns EMPTY when no $cashtag is present', async () => {
    const { fetchCoinGecko } = await import('./coingeckoStep');
    const out = await fetchCoinGecko('no ticker here');
    expect(out.symbol).toBeNull();
    expect(out.priceUsd).toBeNull();
    expect(out.change7dPct).toBeNull();
    expect(out.marketCapRank).toBeNull();
  });

  it('resolves a $cashtag to a full markets snapshot', async () => {
    const { fetchCoinGecko } = await import('./coingeckoStep');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/search')) {
          return { ok: true, json: async () => ({ coins: [{ id: 'bitcoin', symbol: 'btc' }] }) };
        }
        return {
          ok: true,
          json: async () => [
            {
              current_price: 50000,
              market_cap: 1e12,
              market_cap_rank: 1,
              total_volume: 3e10,
              circulating_supply: 19_700_000,
              max_supply: 21_000_000,
              ath_change_percentage: -28.4,
              price_change_percentage_24h_in_currency: 2.5,
              price_change_percentage_7d_in_currency: -4.1,
              price_change_percentage_30d_in_currency: 12.3,
            },
          ],
        };
      }),
    );
    const out = await fetchCoinGecko('thoughts on $BTC today');
    expect(out.symbol).toBe('BTC');
    expect(out.priceUsd).toBe(50000);
    expect(out.change24hPct).toBe(2.5);
    expect(out.change7dPct).toBe(-4.1);
    expect(out.change30dPct).toBe(12.3);
    expect(out.marketCapRank).toBe(1);
    expect(out.volume24hUsd).toBe(3e10);
    expect(out.maxSupply).toBe(21_000_000);
    expect(out.athChangePct).toBe(-28.4);
  });
});

describe('fetchMarketOverview', () => {
  const marketsRows = [
    { symbol: 'btc', current_price: 67420, price_change_percentage_24h: -1.23 },
    { symbol: 'eth', current_price: 3510.5, price_change_percentage_24h: 0.42 },
  ];

  it('summarises top coins and trending searches', async () => {
    const { fetchMarketOverview } = await import('./coingeckoStep');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/coins/markets')) {
          return { ok: true, json: async () => marketsRows };
        }
        return {
          ok: true,
          json: async () => ({ coins: [{ item: { symbol: 'pepe' } }, { item: { symbol: 'wif' } }] }),
        };
      }),
    );
    const out = await fetchMarketOverview();
    expect(out).toContain('BTC $67,420 (-1.2% 24h)');
    expect(out).toContain('ETH $3,511 (+0.4% 24h)');
    expect(out).toContain('Trending searches: PEPE, WIF');
  });

  it('still returns the snapshot when trending fails', async () => {
    const { fetchMarketOverview } = await import('./coingeckoStep');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/coins/markets')) {
          return { ok: true, json: async () => marketsRows };
        }
        throw new Error('trending down');
      }),
    );
    const out = await fetchMarketOverview();
    expect(out).toContain('BTC $67,420');
    expect(out).not.toContain('Trending');
  });

  it('throws when the markets endpoint keeps failing', async () => {
    const { fetchMarketOverview } = await import('./coingeckoStep');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(fetchMarketOverview()).rejects.toThrow('CoinGecko 500');
  });
});
