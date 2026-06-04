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
