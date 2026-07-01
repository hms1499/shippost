import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Address } from 'viem';

// runModeB orchestrates the grounded pipeline (serper → coingecko → groq →
// factCheck) and is the shared engine behind both the Hot Take and Token
// Analysis modes. We mock the four steps and assert the two seams a sibling
// mode overrides: the Serper query and the prompt builder. Default behaviour
// (Hot Take) must keep using eventDescription + buildModeBPrompt.
const runSerperStep = vi.fn();
const runCoinGeckoStep = vi.fn();
const runFactCheckStep = vi.fn();
const generateDraft = vi.fn();

vi.mock('./serperStep', () => ({ runSerperStep }));
vi.mock('./coingeckoStep', () => ({ runCoinGeckoStep }));
vi.mock('./factCheckStep', () => ({ runFactCheckStep }));
vi.mock('./generateDraft', () => ({ generateDraft }));

const { runModeB } = await import('./runModeB');

const baseCtx = {
  chainId: 11142220,
  threadId: 1n,
  topic: '$DOGE',
  audience: 'beginner' as const,
  agentWallet: '0x0000000000000000000000000000000000000001' as Address,
};

function userMessageOf(call: unknown): string {
  const input = (call as [unknown, { messages: Array<{ role: string; content: string }> }])[1];
  return input.messages.find((m) => m.role === 'user')!.content;
}

beforeEach(() => {
  vi.clearAllMocks();
  runSerperStep.mockResolvedValue({ query: 'q', organic: [], newsSnippet: null });
  runCoinGeckoStep.mockResolvedValue({
    symbol: null,
    priceUsd: null,
    change24hPct: null,
    change7dPct: null,
    change30dPct: null,
    marketCapUsd: null,
    marketCapRank: null,
    volume24hUsd: null,
    circulatingSupply: null,
    maxSupply: null,
    athChangePct: null,
  });
  generateDraft.mockResolvedValue({ tweets: ['1', '2'], txHash: '0xabc', costHuman: '0.010', tokenSymbol: 'cUSD' });
  runFactCheckStep.mockResolvedValue({ tweets: ['1', '2'] });
});

describe('runModeB default (Hot Take) behaviour', () => {
  it('queries Serper with the eventDescription', async () => {
    await runModeB({ ...baseCtx, angle: 'skeptical', eventDescription: 'token X depegged' }, () => {});
    expect(runSerperStep).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'token X depegged' }),
      expect.any(Function),
    );
  });

  it('builds the prompt from buildModeBPrompt (mentions the event)', async () => {
    await runModeB({ ...baseCtx, angle: 'bullish', eventDescription: 'unique-event-marker' }, () => {});
    expect(generateDraft).toHaveBeenCalledOnce();
    expect(userMessageOf(generateDraft.mock.calls[0])).toContain('unique-event-marker');
  });
});

describe('runModeB overrides (sibling modes)', () => {
  it('uses serperQuery when provided', async () => {
    await runModeB(
      { ...baseCtx, angle: 'skeptical', eventDescription: 'ignored', serperQuery: 'custom token query' },
      () => {},
    );
    expect(runSerperStep).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'custom token query' }),
      expect.any(Function),
    );
  });

  it('uses marketStep instead of the cashtag CoinGecko step when provided', async () => {
    const marketStep = vi.fn().mockResolvedValue('whole-market snapshot');
    await runModeB(
      {
        ...baseCtx,
        angle: 'skeptical',
        eventDescription: 'ignored',
        marketStep,
        buildPrompt: ({ marketSnippet }) => `PROMPT:${marketSnippet}`,
      },
      () => {},
    );
    expect(marketStep).toHaveBeenCalledOnce();
    expect(runCoinGeckoStep).not.toHaveBeenCalled();
    expect(userMessageOf(generateDraft.mock.calls[0])).toBe('PROMPT:whole-market snapshot');
  });

  it('uses buildPrompt when provided', async () => {
    await runModeB(
      {
        ...baseCtx,
        angle: 'bullish',
        eventDescription: 'ignored',
        buildPrompt: () => 'SENTINEL_PROMPT_BODY',
      },
      () => {},
    );
    expect(userMessageOf(generateDraft.mock.calls[0])).toBe('SENTINEL_PROMPT_BODY');
  });
});
