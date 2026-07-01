import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeBPrompt, summarizeSerper, summarizeMarket, type Angle } from '@/lib/prompts/modeB';
import { runSerperStep, type SerperOptions } from './serperStep';
import { runCoinGeckoStep } from './coingeckoStep';
import { runFactCheckStep } from './factCheckStep';
import { generateDraft, type DraftResult } from './generateDraft';
import type { PipelineContext, PipelineEvent } from './types';


export interface ModeBOutput {
  tweets: string[];
  searchSummary: string | null;
  marketSnippet: string | null;
  totalCostUsd: string;
}

interface ModeBContext extends PipelineContext {
  angle: Angle;
  eventDescription: string;
  // Optional overrides so sibling modes (e.g. Token Analysis) can reuse this
  // vetted settle/delivery orchestration with a different query + prompt.
  // Defaults reproduce Hot Take exactly.
  serperQuery?: string;
  // Recency / endpoint tuning for the search step (e.g. dated /news for the
  // Daily Recap, a recency bias for event/token threads). Defaults to a plain,
  // unrestricted /search — Hot Take's original behaviour.
  serperOpts?: SerperOptions;
  buildPrompt?: (args: { searchSummary: string | null; marketSnippet: string | null }) => string;
  // Replaces the cashtag CoinGecko lookup with a custom market step (e.g. the
  // Daily Recap whole-market overview). Must emit the 'coingecko' lifecycle
  // itself and return the ready-to-use snippet.
  marketStep?: (ctx: PipelineContext, emit: (e: PipelineEvent) => void) => Promise<string | null>;
}

export async function runModeB(
  ctx: ModeBContext,
  emit: (e: PipelineEvent) => void,
): Promise<ModeBOutput> {
  let totalCost = 0;

  const wrappedEmit = (e: PipelineEvent) => {
    if (e.type === 'step_settled' && e.step !== 'coingecko') {
      const c = parseFloat(e.costAmount);
      if (!Number.isNaN(c)) totalCost += c;
    }
    emit(e);
  };

  // Step 1 — Serper search (soft-fail: continue with null context if API or settle fails)
  let searchSummary: string | null = null;
  try {
    const s = await runSerperStep(
      { ...ctx, query: ctx.serperQuery ?? ctx.eventDescription, serperOpts: ctx.serperOpts },
      wrappedEmit,
    );
    searchSummary = summarizeSerper(s.organic, s.newsSnippet);
  } catch (e) {
    console.error('[runModeB] serper failed, continuing with no search context:', e);
    // Surface the degradation: non-terminal in the hook (only `fatal` ends
    // the run), so the user sees the thread was built without search context
    // rather than silently paying full price for a degraded result.
    emit({ type: 'step_failed', step: 'serper', error: e instanceof Error ? e.message : 'search failed' });
  }

  // Step 2 — CoinGecko market data (soft-fail: free API, no x402 settle)
  let marketSnippet: string | null = null;
  try {
    if (ctx.marketStep) {
      marketSnippet = await ctx.marketStep(ctx, wrappedEmit);
    } else {
      const cg = await runCoinGeckoStep(ctx, wrappedEmit);
      marketSnippet = summarizeMarket(cg);
    }
  } catch (e) {
    console.error('[runModeB] coingecko failed:', e);
    emit({ type: 'step_failed', step: 'coingecko', error: e instanceof Error ? e.message : 'market data failed' });
  }

  // Step 3 — Groq draft (HARD-fail: strict-settle, no thread = no value)
  emit({ type: 'step_started', step: 'groq' });

  const userPrompt = ctx.buildPrompt
    ? ctx.buildPrompt({ searchSummary, marketSnippet })
    : buildModeBPrompt({
        eventDescription: ctx.eventDescription,
        angle: ctx.angle,
        searchSummary,
        marketSnippet,
      });

  let draft: DraftResult;
  try {
    draft = await generateDraft(ctx, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.85,
      maxTokens: 1400,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'draft failed';
    emit({ type: 'step_failed', step: 'groq', error: msg });
    throw e;
  }

  wrappedEmit({
    type: 'step_settled',
    step: 'groq',
    txHash: draft.txHash,
    costAmount: draft.costHuman,
    tokenSymbol: draft.tokenSymbol,
  });
  emit({ type: 'step_output', step: 'groq', output: draft.tweets });

  const draftTweets = draft.tweets;

  // Step 4 — Fact-check (soft-fail: fall back to draft if fact-check errors)
  let finalTweets = draftTweets;
  try {
    const fc = await runFactCheckStep(
      ctx,
      { tweets: draftTweets, searchSummary, marketData: marketSnippet },
      wrappedEmit,
    );
    finalTweets = fc.tweets;
  } catch (e) {
    console.error('[runModeB] fact-check failed, using draft:', e);
    emit({ type: 'step_failed', step: 'factCheck', error: e instanceof Error ? e.message : 'fact-check failed' });
  }

  return {
    tweets: finalTweets,
    searchSummary,
    marketSnippet,
    totalCostUsd: totalCost.toFixed(3),
  };
}
