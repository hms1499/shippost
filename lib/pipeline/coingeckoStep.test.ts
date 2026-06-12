import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchCoinGecko', () => {
  it('returns EMPTY when no $cashtag is present', async () => {
    const { fetchCoinGecko } = await import('./coingeckoStep');
    const out = await fetchCoinGecko('no ticker here');
    expect(out).toEqual({ symbol: null, priceUsd: null, change24hPct: null, marketCapUsd: null });
  });

  it('resolves a $cashtag to price data', async () => {
    const { fetchCoinGecko } = await import('./coingeckoStep');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/search')) {
          return { ok: true, json: async () => ({ coins: [{ id: 'bitcoin', symbol: 'btc' }] }) };
        }
        return {
          ok: true,
          json: async () => ({ bitcoin: { usd: 50000, usd_24h_change: 2.5, usd_market_cap: 1e12 } }),
        };
      }),
    );
    const out = await fetchCoinGecko('thoughts on $BTC today');
    expect(out.symbol).toBe('BTC');
    expect(out.priceUsd).toBe(50000);
    expect(out.change24hPct).toBe(2.5);
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
