import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

// Each test re-imports the module so the process-level protocols cache never
// leaks state across cases.
beforeEach(() => {
  vi.resetModules();
});

const protocols = [
  { name: 'Aave V2', symbol: 'AAVE', tvl: 5_000_000_000, change_7d: 1.2, category: 'Lending' },
  { name: 'Aave V3', symbol: 'AAVE', tvl: 9_000_000_000, change_7d: 3.4, category: 'Lending' },
  { name: 'Uniswap', symbol: 'UNI', tvl: 4_200_000_000, change_7d: -2.0, category: 'Dexes' },
];

describe('fetchProtocolTvl', () => {
  it('picks the highest-TVL row for a matching ticker', async () => {
    const { fetchProtocolTvl } = await import('./defiLlamaStep');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => protocols })));
    const out = await fetchProtocolTvl('$AAVE');
    expect(out).not.toBeNull();
    expect(out!.name).toBe('Aave V3');
    expect(out!.tvlUsd).toBe(9_000_000_000);
    expect(out!.change7dPct).toBe(3.4);
  });

  it('returns null for a ticker that is not a protocol', async () => {
    const { fetchProtocolTvl } = await import('./defiLlamaStep');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => protocols })));
    expect(await fetchProtocolTvl('BTC')).toBeNull();
  });

  it('soft-fails to null when the list endpoint is down', async () => {
    const { fetchProtocolTvl } = await import('./defiLlamaStep');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));
    expect(await fetchProtocolTvl('$UNI')).toBeNull();
  });
});

describe('summarizeProtocolTvl', () => {
  it('formats TVL with the mcap/TVL ratio when mcap is known', async () => {
    const { summarizeProtocolTvl } = await import('./defiLlamaStep');
    const line = summarizeProtocolTvl(
      { name: 'Uniswap', tvlUsd: 4_200_000_000, change1dPct: null, change7dPct: -2.0, category: 'Dexes' },
      8_400_000_000,
    );
    expect(line).toContain('TVL $4.20B');
    expect(line).toContain('Dexes');
    expect(line).toContain('mcap/TVL 2.00');
    expect(line).toContain('TVL 7d -2.0%');
  });

  it('returns null when there is no protocol', async () => {
    const { summarizeProtocolTvl } = await import('./defiLlamaStep');
    expect(summarizeProtocolTvl(null, 1e9)).toBeNull();
  });
});

describe('fetchDefiOverview', () => {
  it('sums chain TVL and totals stablecoin supply', async () => {
    const { fetchDefiOverview } = await import('./defiLlamaStep');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/v2/chains')) {
          return {
            ok: true,
            json: async () => [
              { name: 'Ethereum', tvl: 58_000_000_000 },
              { name: 'Solana', tvl: 12_000_000_000 },
            ],
          };
        }
        return {
          ok: true,
          json: async () => ({
            peggedAssets: [
              { circulating: { peggedUSD: 120_000_000_000 } },
              { circulating: { peggedUSD: 48_000_000_000 } },
            ],
          }),
        };
      }),
    );
    const out = await fetchDefiOverview();
    expect(out).toContain('DeFi TVL: $70.00B across all chains');
    expect(out).toContain('top chain Ethereum $58.00B');
    expect(out).toContain('Stablecoin supply: $168.00B');
  });

  it('still returns the DeFi TVL line when stablecoins fail', async () => {
    const { fetchDefiOverview } = await import('./defiLlamaStep');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('/v2/chains')) {
          return { ok: true, json: async () => [{ name: 'Ethereum', tvl: 58_000_000_000 }] };
        }
        return { ok: false, status: 500 };
      }),
    );
    const out = await fetchDefiOverview();
    expect(out).toContain('DeFi TVL: $58.00B');
    expect(out).not.toContain('Stablecoin');
  });

  it('returns null when everything fails', async () => {
    const { fetchDefiOverview } = await import('./defiLlamaStep');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    expect(await fetchDefiOverview()).toBeNull();
  });
});
