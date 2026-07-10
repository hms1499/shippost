import { describe, it, expect, vi, beforeEach } from 'vitest';

const runModeB = vi.fn(async (_ctx: unknown, _emit: unknown) => ({
  tweets: ['1/ x'],
  totalCostUsd: '0.003',
  searchSummary: null,
  marketSnippet: 'Solana: TVL $9.10B (+4.2% 7d)\nBase: TVL $3.40B (-1.5% 7d)',
}));

vi.mock('@/lib/pipeline/runModeB', () => ({ runModeB }));
vi.mock('@/lib/pipeline/defiLlamaStep', () => ({
  fetchChainTvl: vi.fn(async () => ({ tvlUsd: 1_000_000_000, change7dPct: 1 })),
  summarizeChainTvl: vi.fn(() => 'A: TVL $1.00B (+1.0% 7d)'),
}));
vi.mock('@/lib/pipeline/serperStep', () => ({ fetchSerper: vi.fn() }));
vi.mock('@/lib/pipeline/generateDraft', () => ({ generateTweets: vi.fn(async () => ['1/ x']) }));

const { comparisonMode } = await import('./comparison');

const baseCtx = {
  chainId: 42220,
  threadId: 1n,
  topic: 'solana|base',
  audience: 'beginner' as const,
  agentWallet: '0x0000000000000000000000000000000000000000' as const,
};

describe('comparisonMode.validateInput', () => {
  it('accepts a valid distinct pair', () => {
    expect(comparisonMode.validateInput({ topic: 'solana|base' })).toBeNull();
  });
  it('rejects equal chains', () => {
    expect(comparisonMode.validateInput({ topic: 'base|base' })).not.toBeNull();
  });
  it('rejects an unknown chain', () => {
    expect(comparisonMode.validateInput({ topic: 'solana|nope' })).not.toBeNull();
  });
  it('rejects missing topic', () => {
    expect(comparisonMode.validateInput({})).not.toBeNull();
  });
});

describe('comparisonMode.run', () => {
  beforeEach(() => runModeB.mockClear());

  it('passes a serperQuery naming both chains and a comparison buildPrompt', async () => {
    await comparisonMode.run({ ...baseCtx }, { topic: 'solana|base' }, () => {});
    expect(runModeB).toHaveBeenCalledTimes(1);
    const overrides = runModeB.mock.calls[0][0] as any;
    expect(overrides.serperQuery).toContain('Solana');
    expect(overrides.serperQuery).toContain('Base');
    const prompt = overrides.buildPrompt({ searchSummary: null, marketSnippet: 'A: TVL $1.00B (+1.0% 7d)' });
    expect(prompt.toLowerCase()).toContain('winner');
  });
});
