import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Address } from 'viem';

// runModeA is the Educational engine: a soft, paid Serper grounding step feeds
// reference facts into the Groq draft. We mock both steps and assert the seam —
// grounding flows into groq, soft-fails cleanly, and the returned total tracks
// whatever actually settled.
const runSerperStep = vi.fn();
const runGroqStep = vi.fn();

vi.mock('./serperStep', () => ({ runSerperStep }));
vi.mock('./groqStep', () => ({ runGroqStep }));

const { runModeA } = await import('./runModeA');

const baseCtx = {
  chainId: 11142220,
  threadId: 1n,
  topic: 'EIP-712',
  audience: 'beginner' as const,
  agentWallet: '0x0000000000000000000000000000000000000001' as Address,
  tokenSymbol: 'cUSD' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  runGroqStep.mockResolvedValue({ tweets: ['1/ a', '2/ b'] });
});

describe('runModeA', () => {
  it('grounds on the topic and passes the search summary into groq', async () => {
    runSerperStep.mockImplementation(async (_ctx, emit) => {
      emit({ type: 'step_settled', step: 'serper', txHash: '0xser', costAmount: '0.001', tokenSymbol: 'cUSD' });
      return { query: 'q', organic: [{ title: 'EIP-712 spec', snippet: 'typed data', link: 'l' }], newsSnippet: null };
    });
    runGroqStep.mockImplementation(async (_ctx, emit) => {
      emit({ type: 'step_settled', step: 'groq', txHash: '0xgro', costAmount: '0.010', tokenSymbol: 'cUSD' });
      return { tweets: ['1/ a', '2/ b'] };
    });

    const out = await runModeA(baseCtx, () => {});

    // Serper is queried with the topic.
    const serperCtx = runSerperStep.mock.calls[0]![0] as { query: string };
    expect(serperCtx.query).toContain('EIP-712');
    // The summary reaches groq as fact-anchor context.
    const groqOpts = runGroqStep.mock.calls[0]![2] as { searchSummary: string | null };
    expect(groqOpts.searchSummary).toContain('EIP-712 spec');
    // Total covers both settles.
    expect(out.totalCostUsd).toBe('0.011');
  });

  it('soft-fails grounding and still drafts, billing only what settled', async () => {
    runSerperStep.mockRejectedValue(new Error('serper down'));
    runGroqStep.mockImplementation(async (_ctx, emit) => {
      emit({ type: 'step_settled', step: 'groq', txHash: '0xgro', costAmount: '0.010', tokenSymbol: 'cUSD' });
      return { tweets: ['1/ a', '2/ b'] };
    });

    const out = await runModeA(baseCtx, () => {});

    expect(out.tweets).toHaveLength(2);
    expect(out.searchSummary).toBeNull();
    // groq still ran, with no reference facts.
    const groqOpts = runGroqStep.mock.calls[0]![2] as { searchSummary: string | null };
    expect(groqOpts.searchSummary).toBeNull();
    // Only the groq settle is billed — the failed serper never settled.
    expect(out.totalCostUsd).toBe('0.010');
  });
});
