import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const generateTweets = vi.fn();
const fetchSerper = vi.fn();
const fetchCoinGecko = vi.fn();
const fetchMarketOverview = vi.fn();

vi.mock('./generateDraft', () => ({ generateTweets }));
vi.mock('./serperStep', () => ({ fetchSerper }));
vi.mock('./coingeckoStep', () => ({
  fetchCoinGecko,
  fetchMarketOverview,
  runMarketOverviewStep: vi.fn(),
}));
// The mode descriptors import the paid pipelines for their run() methods; the
// preview path never calls them, so mock them out to keep this test isolated.
vi.mock('@/lib/pipeline/runModeA', () => ({ runModeA: vi.fn(), MODE_A_TOTAL_COST_USD: '0.050' }));
vi.mock('@/lib/pipeline/runModeB', () => ({ runModeB: vi.fn() }));

const { runPreview } = await import('./runPreview');

beforeEach(() => {
  vi.clearAllMocks();
  generateTweets.mockResolvedValue(['1/ hook', '2/ body']);
});

describe('runPreview', () => {
  it('Mode A: generates from topic/audience, no grounding calls', async () => {
    const out = await runPreview({ mode: 0, topic: 'EIP-712', audience: 'beginner' });
    expect(out.tweets).toHaveLength(2);
    expect(fetchSerper).not.toHaveBeenCalled();
    expect(fetchCoinGecko).not.toHaveBeenCalled();
    expect(generateTweets).toHaveBeenCalledOnce();
  });

  it('Mode B: runs grounding (serper + coingecko) then generates', async () => {
    fetchSerper.mockResolvedValue({ query: 'q', organic: [], newsSnippet: null });
    fetchCoinGecko.mockResolvedValue({ symbol: null, priceUsd: null, change24hPct: null, marketCapUsd: null });
    const out = await runPreview({ mode: 1, eventDescription: 'BTC ETF', angle: 'bullish' });
    expect(fetchSerper).toHaveBeenCalledOnce();
    expect(fetchCoinGecko).toHaveBeenCalledOnce();
    expect(out.tweets).toHaveLength(2);
  });

  it('Mode B: soft-fails grounding and still generates', async () => {
    fetchSerper.mockRejectedValue(new Error('serper down'));
    fetchCoinGecko.mockRejectedValue(new Error('cg down'));
    const out = await runPreview({ mode: 1, eventDescription: 'BTC ETF', angle: 'bearish' });
    expect(generateTweets).toHaveBeenCalledOnce();
    expect(out.tweets).toHaveLength(2);
  });

  it('Token Analysis (mode 2): grounds on the ticker then generates', async () => {
    fetchSerper.mockResolvedValue({ query: 'q', organic: [], newsSnippet: null });
    fetchCoinGecko.mockResolvedValue({ symbol: 'CELO', priceUsd: 0.5, change24hPct: 2, marketCapUsd: 2.8e8 });
    const out = await runPreview({ mode: 2, topic: 'celo', angle: 'bullish' });
    // Serper query is the ticker-oriented query, normalised to $CELO.
    expect(fetchSerper).toHaveBeenCalledWith(expect.stringContaining('$CELO'));
    // CoinGecko is fed the normalised $cashtag so it can resolve the coin.
    expect(fetchCoinGecko).toHaveBeenCalledWith('$CELO');
    expect(out.tweets).toHaveLength(2);
  });

  it('Daily Recap (mode 3): grounds on the market overview, no input needed', async () => {
    fetchSerper.mockResolvedValue({ query: 'q', organic: [], newsSnippet: null });
    fetchMarketOverview.mockResolvedValue('BTC $67,420 (-1.2% 24h)');
    const out = await runPreview({ mode: 3 });
    expect(fetchSerper).toHaveBeenCalledOnce();
    expect(fetchMarketOverview).toHaveBeenCalledOnce();
    expect(fetchCoinGecko).not.toHaveBeenCalled();
    expect(out.tweets).toHaveLength(2);
  });

  it('Daily Recap: soft-fails grounding and still generates', async () => {
    fetchSerper.mockRejectedValue(new Error('serper down'));
    fetchMarketOverview.mockRejectedValue(new Error('cg down'));
    const out = await runPreview({ mode: 3 });
    expect(generateTweets).toHaveBeenCalledOnce();
    expect(out.tweets).toHaveLength(2);
  });
});

describe('preview drain-safety invariant', () => {
  it('no preview source references settle / AgentWallet / supabase', () => {
    const files = [
      './runPreview.ts',
      './modes/educational.ts',
      './modes/hotTake.ts',
      './modes/tokenAnalysis.ts',
      './modes/dailyRecap.ts',
    ];
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/settleX402Call/);
      expect(src, f).not.toMatch(/agentWallet|AgentWallet/);
      expect(src, f).not.toMatch(/supabase/i);
    }
  });
});
