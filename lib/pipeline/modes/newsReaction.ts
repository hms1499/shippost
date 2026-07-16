// lib/pipeline/modes/newsReaction.ts
import { runModeB } from '@/lib/pipeline/runModeB';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { summarizeSerper, summarizeMarket } from '@/lib/prompts/modeB';
import { buildNewsBreakdownPrompt } from '@/lib/prompts/newsReaction';
import { generateTweets } from '@/lib/pipeline/generateDraft';
import { fetchSerper } from '@/lib/pipeline/serperStep';
import { fetchCoinGecko } from '@/lib/pipeline/coingeckoStep';
import { composeEvent } from '@/lib/eventContext';
import type { ModeDef } from './types';

export const newsReactionMode: ModeDef = {
  id: 5,
  key: 'newsReaction',
  validateInput(b) {
    // A stray `angle` is ignored, not rejected: hostile body, harmless field.
    if (!b.eventDescription?.trim()) return 'eventDescription required for News Breakdown';
    return null;
  },
  async run(ctx, body, emit) {
    // Ground in the pasted URL's OG metadata when present (same contract as
    // Hot Take): the LLM sees headline+summary, Serper searches the headline.
    const { event, query } = composeEvent(body.eventDescription ?? '', body.eventContext);
    const out = await runModeB(
      {
        ...ctx,
        angle: 'skeptical', // required by type; buildPrompt fully overrides it
        eventDescription: event,
        serperQuery: query,
        // "News" older than a week isn't news; qdr:d would miss items indexed
        // just over 24h ago (overnight in VN time).
        serperOpts: { recency: 'qdr:w' },
        buildPrompt: ({ searchSummary, marketSnippet }) =>
          buildNewsBreakdownPrompt({ event, searchSummary, marketSnippet }),
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
  async preview(input) {
    // Grounding is soft: a failed Serper/CoinGecko still yields a draft. Mirror
    // the paid path so the free preview reflects what paying will produce.
    const { event, query } = composeEvent(input.eventDescription ?? '', input.eventContext);
    let searchSummary: string | null = null;
    try {
      const s = await fetchSerper(query, { recency: 'qdr:w' });
      searchSummary = summarizeSerper(s.organic, s.newsSnippet);
    } catch (e) {
      console.error('[newsReaction.preview] serper failed, continuing:', e instanceof Error ? e.message : e);
    }
    let marketSnippet: string | null = null;
    try {
      marketSnippet = summarizeMarket(await fetchCoinGecko(event));
    } catch (e) {
      console.error('[newsReaction.preview] coingecko failed, continuing:', e instanceof Error ? e.message : e);
    }
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: buildNewsBreakdownPrompt({ event, searchSummary, marketSnippet }) },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.85, maxTokens: 1400 }) };
  },
};
