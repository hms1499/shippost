import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const generateTweets = vi.fn();
const fetchSerper = vi.fn();
const fetchCoinGecko = vi.fn();

vi.mock('./generateDraft', () => ({ generateTweets }));
vi.mock('./serperStep', () => ({ fetchSerper }));
vi.mock('./coingeckoStep', () => ({ fetchCoinGecko }));

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
});

describe('runPreview drain-safety invariant', () => {
  it('source never references settle / AgentWallet / supabase', () => {
    const src = readFileSync(new URL('./runPreview.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/settleX402Call/);
    expect(src).not.toMatch(/agentWallet|AgentWallet/);
    expect(src).not.toMatch(/supabase/i);
  });
});
