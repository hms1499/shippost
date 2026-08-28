// lib/pipeline/modes/comparison.ts
import { runModeB } from '@/lib/pipeline/runModeB';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { summarizeSerper } from '@/lib/prompts/modeB';
import { buildComparisonPrompt, parseChains, serperQueryFor } from '@/lib/prompts/comparison';
import { generateTweets } from '@/lib/pipeline/generateDraft';
import { fetchSerper } from '@/lib/pipeline/serperStep';
import { fetchChainTvl, summarizeChainTvl } from '@/lib/pipeline/defiLlamaStep';
import type { ChainEntry } from '@/lib/prompts/comparison';
import type { PipelineContext, PipelineEvent } from '@/lib/pipeline/types';
import type { ModeDef } from './types';

// Free, no-settle market step: fetch both chains' TVL from DefiLlama in
// parallel and emit under the 'coingecko' lifecycle slot (same fold Daily
// Recap uses). Returns null only when NEITHER chain resolved.
async function chainMarketStep(
  a: ChainEntry,
  b: ChainEntry,
  emit: (e: PipelineEvent) => void,
  tokenSymbol: PipelineContext['tokenSymbol'],
): Promise<string | null> {
  emit({ type: 'step_started', step: 'coingecko' });
  let snippet: string | null = null;
  try {
    const [ta, tb] = await Promise.all([
      fetchChainTvl(a.defiLlamaName),
      fetchChainTvl(b.defiLlamaName),
    ]);
    snippet = summarizeChainTvl(a.label, ta, b.label, tb);
  } catch (e) {
    console.error('[comparison] chain TVL failed, continuing:', e instanceof Error ? e.message : e);
  }
  emit({ type: 'step_output', step: 'coingecko', output: snippet });
  emit({
    type: 'step_settled',
    step: 'coingecko',
    txHash: '0x0',
    costAmount: '0.000',
    tokenSymbol,
  });
  return snippet;
}

export const comparisonMode: ModeDef = {
  id: 4,
  key: 'comparison',
  validateInput(b) {
    if (!parseChains(b.topic)) return 'two distinct whitelisted chains required for Comparison';
    return null;
  },
  async run(ctx, body, emit) {
    // validateInput already gated this; non-null by contract.
    const [a, b] = parseChains(body.topic)!;
    const out = await runModeB(
      {
        ...ctx,
        angle: 'skeptical', // required by type; buildPrompt fully overrides it
        eventDescription: `${a.label} vs ${b.label}`, // fallback only
        serperQuery: serperQueryFor(a.label, b.label),
        serperOpts: { recency: 'qdr:m' },
        marketStep: (c: PipelineContext, e) => chainMarketStep(a, b, e, c.tokenSymbol),
        buildPrompt: ({ searchSummary, marketSnippet }) =>
          buildComparisonPrompt({ aLabel: a.label, bLabel: b.label, chainData: marketSnippet, searchSummary }),
      },
      emit,
    );
    return {
      tweets: out.tweets,
      totalCostUsd: out.totalCostUsd,
      searchSummary: out.searchSummary,
      marketSnippet: out.marketSnippet,
    };
  },
  async buildMessages(input) {
    const pair = parseChains(input.topic);
    if (!pair) return null;
    const [a, b] = pair;
    let searchSummary: string | null = null;
    try {
      const s = await fetchSerper(serperQueryFor(a.label, b.label), { recency: 'qdr:m' });
      searchSummary = summarizeSerper(s.organic, s.newsSnippet);
    } catch (e) {
      console.error('[comparison.buildMessages] serper failed, continuing:', e instanceof Error ? e.message : e);
    }
    let chainData: string | null = null;
    try {
      const [ta, tb] = await Promise.all([
        fetchChainTvl(a.defiLlamaName),
        fetchChainTvl(b.defiLlamaName),
      ]);
      chainData = summarizeChainTvl(a.label, ta, b.label, tb);
    } catch (e) {
      console.error('[comparison.buildMessages] chain TVL failed, continuing:', e instanceof Error ? e.message : e);
    }
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: buildComparisonPrompt({ aLabel: a.label, bLabel: b.label, chainData, searchSummary }) },
    ];
    return { messages, temperature: 0.85, maxTokens: 1400 };
  },
  async preview(input) {
    const draft = await comparisonMode.buildMessages(input);
    return { tweets: draft ? await generateTweets(draft) : [] };
  },
};
