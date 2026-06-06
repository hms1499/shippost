// lib/pipeline/modes/hotTake.ts
import { runModeB } from '@/lib/pipeline/runModeB';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeBPrompt, summarizeSerper, summarizeMarket, type Angle } from '@/lib/prompts/modeB';
import { generateTweets } from '@/lib/pipeline/generateDraft';
import { fetchSerper } from '@/lib/pipeline/serperStep';
import { fetchCoinGecko } from '@/lib/pipeline/coingeckoStep';
import type { ModeDef } from './types';

const VALID_ANGLES: Angle[] = ['bullish', 'bearish', 'skeptical'];

export const hotTakeMode: ModeDef = {
  id: 1,
  key: 'hotTake',
  validateInput(b) {
    if (!b.eventDescription?.trim()) return 'eventDescription required for Mode B';
    if (b.angle && !VALID_ANGLES.includes(b.angle)) return 'invalid angle';
    return null;
  },
  async run(ctx, body, emit) {
    const out = await runModeB(
      { ...ctx, angle: body.angle ?? 'skeptical', eventDescription: body.eventDescription ?? '' },
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
    // Grounding is soft: a failed Serper/CoinGecko still yields a draft.
    const event = input.eventDescription ?? '';
    let searchSummary: string | null = null;
    try {
      const s = await fetchSerper(event);
      searchSummary = summarizeSerper(s.organic, s.newsSnippet);
    } catch (e) {
      console.error('[hotTake.preview] serper failed, continuing:', e instanceof Error ? e.message : e);
    }
    let marketSnippet: string | null = null;
    try {
      marketSnippet = summarizeMarket(await fetchCoinGecko(event));
    } catch (e) {
      console.error('[hotTake.preview] coingecko failed, continuing:', e instanceof Error ? e.message : e);
    }
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildModeBPrompt({
          eventDescription: event,
          angle: input.angle ?? 'bullish',
          searchSummary,
          marketSnippet,
        }),
      },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.85, maxTokens: 1400 }) };
  },
};
