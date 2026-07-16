import { describe, it, expect, vi, beforeEach } from 'vitest';

const runModeB = vi.fn(async (_ctx: unknown, _emit: unknown) => ({
  tweets: ['1/ x'],
  totalCostUsd: '0.003',
  searchSummary: null,
  marketSnippet: null,
}));
vi.mock('@/lib/pipeline/runModeB', () => ({ runModeB }));
vi.mock('@/lib/pipeline/serperStep', () => ({
  fetchSerper: vi.fn(async () => ({ organic: [], newsSnippet: null })),
}));
vi.mock('@/lib/pipeline/coingeckoStep', () => ({
  fetchCoinGecko: vi.fn(async () => ({ symbol: null, priceUsd: null })),
}));
vi.mock('@/lib/pipeline/generateDraft', () => ({
  generateTweets: vi.fn(async () => ['1/ draft']),
}));

const { newsReactionMode } = await import('./newsReaction');

// runModeB is a module-level mock shared across every describe below; clear it
// before each test so a call recorded in one describe can't leak into an
// unrelated "was/wasn't called" assertion in another (e.g. preview's
// not-called check after run's tests have already invoked it).
beforeEach(() => runModeB.mockClear());

const baseCtx = {
  chainId: 42220,
  threadId: 1n,
  topic: 'x',
  audience: 'beginner' as const,
  agentWallet: '0x0000000000000000000000000000000000000000' as const,
};

describe('newsReactionMode.validateInput', () => {
  it('requires eventDescription', () => {
    expect(newsReactionMode.validateInput({})).not.toBeNull();
    expect(newsReactionMode.validateInput({ eventDescription: '  ' })).not.toBeNull();
  });
  it('accepts eventDescription and ignores a stray angle', () => {
    expect(
      newsReactionMode.validateInput({ eventDescription: 'SEC approves ETH ETFs', angle: 'bullish' }),
    ).toBeNull();
  });
});

describe('newsReactionMode.run', () => {
  beforeEach(() => runModeB.mockClear());

  it('grounds in eventContext, passes qdr:w recency and the neutral prompt', async () => {
    await newsReactionMode.run(
      { ...baseCtx },
      {
        eventDescription: 'https://x.co/a',
        eventContext: { title: 'BTC ETF record inflows', description: 'daily record', host: 'x.co' },
      },
      () => {},
    );
    expect(runModeB).toHaveBeenCalledTimes(1);
    const overrides = runModeB.mock.calls[0][0] as any;
    expect(overrides.serperQuery).toBe('BTC ETF record inflows');
    expect(overrides.serperOpts).toEqual({ recency: 'qdr:w' });
    const prompt = overrides.buildPrompt({ searchSummary: null, marketSnippet: null });
    expect(prompt).toContain('Never pick a side');
    expect(prompt).toContain('BTC ETF record inflows');
  });

  it('falls back to raw text when there is no eventContext', async () => {
    await newsReactionMode.run({ ...baseCtx }, { eventDescription: 'Celo upgrades to L2' }, () => {});
    const overrides = runModeB.mock.calls[0][0] as any;
    expect(overrides.serperQuery).toBe('Celo upgrades to L2');
  });
});

describe('newsReactionMode.preview', () => {
  it('drafts via generateTweets and never touches runModeB', async () => {
    const out = await newsReactionMode.preview({ mode: 5, eventDescription: 'Celo upgrades to L2' });
    expect(out.tweets).toEqual(['1/ draft']);
    expect(runModeB).not.toHaveBeenCalled();
  });
});
