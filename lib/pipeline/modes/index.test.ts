// lib/pipeline/modes/index.test.ts
import { describe, it, expect, vi } from 'vitest';

// Keep the registry test pure: importing the descriptors must not drag in the
// real paid pipeline (groq-sdk, env, etc.). We only exercise the id→def map.
vi.mock('@/lib/pipeline/runModeA', () => ({ runModeA: vi.fn(), MODE_A_TOTAL_COST_USD: '0.050' }));
vi.mock('@/lib/pipeline/runModeB', () => ({ runModeB: vi.fn() }));
vi.mock('@/lib/pipeline/generateDraft', () => ({ generateTweets: vi.fn() }));
vi.mock('@/lib/pipeline/serperStep', () => ({ fetchSerper: vi.fn() }));
vi.mock('@/lib/pipeline/coingeckoStep', () => ({
  fetchCoinGecko: vi.fn(),
  fetchMarketOverview: vi.fn(),
  runMarketOverviewStep: vi.fn(),
}));
vi.mock('@/lib/pipeline/defiLlamaStep', () => ({
  fetchChainTvl: vi.fn(),
  summarizeChainTvl: vi.fn(),
  fetchDefiOverview: vi.fn(),
}));

const { getMode, MODES } = await import('./index');

describe('mode registry', () => {
  it('maps id 0 to the educational mode', () => {
    expect(getMode(0)?.id).toBe(0);
    expect(getMode(0)?.key).toBe('educational');
  });

  it('maps id 1 to the hot-take mode', () => {
    expect(getMode(1)?.key).toBe('hotTake');
  });

  it('maps id 2 to the token-analysis mode', () => {
    expect(getMode(2)?.id).toBe(2);
    expect(getMode(2)?.key).toBe('tokenAnalysis');
  });

  it('maps id 3 to the daily-recap mode', () => {
    expect(getMode(3)?.id).toBe(3);
    expect(getMode(3)?.key).toBe('dailyRecap');
  });

  it('daily-recap requires no input', () => {
    expect(getMode(3)?.validateInput({})).toBeNull();
  });

  it('maps id 4 to the comparison mode', () => {
    expect(getMode(4)?.id).toBe(4);
    expect(getMode(4)?.key).toBe('comparison');
  });

  it('maps id 5 to the news-breakdown mode', () => {
    expect(getMode(5)?.id).toBe(5);
    expect(getMode(5)?.key).toBe('newsReaction');
  });

  it('returns null for an unknown mode id', () => {
    expect(getMode(7)).toBeNull();
  });

  it('returns null for undefined/null', () => {
    expect(getMode(undefined)).toBeNull();
    expect(getMode(null)).toBeNull();
  });

  it('every registered mode key matches its map id', () => {
    for (const [id, mode] of Object.entries(MODES)) {
      expect(mode.id).toBe(Number(id));
    }
  });
});
