// lib/pipeline/modes/dailyRecap.ts
import { runModeB } from '@/lib/pipeline/runModeB';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { summarizeSerper } from '@/lib/prompts/modeB';
import { buildDailyRecapPrompt } from '@/lib/prompts/dailyRecap';
import { generateTweets } from '@/lib/pipeline/generateDraft';
import { fetchSerper } from '@/lib/pipeline/serperStep';
import { fetchMarketOverview, runMarketOverviewStep } from '@/lib/pipeline/coingeckoStep';
import { fetchDefiOverview } from '@/lib/pipeline/defiLlamaStep';
import type { ModeDef } from './types';

// One-tap mode: no user input. The grounding IS the input — today's market
// snapshot + today's headlines.
const SERPER_QUERY =
  'crypto news today bitcoin ethereum etf regulation biggest market moves';

const joinSnippet = (...parts: (string | null)[]): string | null =>
  parts.filter(Boolean).join('\n') || null;

// DeFi TVL + stablecoin supply macro backdrop (DefiLlama), soft: null on any
// failure so the recap still ships on CoinGecko + Serper grounding.
async function defiLine(): Promise<string | null> {
  try {
    return await fetchDefiOverview();
  } catch (e) {
    console.error('[dailyRecap] defillama failed, continuing:', e instanceof Error ? e.message : e);
    return null;
  }
}

export const dailyRecapMode: ModeDef = {
  id: 3,
  key: 'dailyRecap',
  validateInput() {
    // Deliberately input-free: nothing in the body is required (or read).
    return null;
  },
  async run(ctx, _body, emit) {
    // Reuse runModeB's vetted settle/delivery orchestration; only the query,
    // market step and prompt differ. `angle` is required by the context type
    // but unused — buildPrompt fully overrides the angled Hot Take prompt.
    const out = await runModeB(
      {
        ...ctx,
        angle: 'skeptical',
        eventDescription: 'crypto market today',
        serperQuery: SERPER_QUERY,
        // Today's recap wants today's headlines: the dated /news endpoint,
        // restricted to the past day.
        serperOpts: { mode: 'news', recency: 'qdr:d' },
        marketStep: async (c, emit) =>
          joinSnippet(await runMarketOverviewStep(c, emit), await defiLine()),
        buildPrompt: ({ searchSummary, marketSnippet }) =>
          buildDailyRecapPrompt({ searchSummary, marketSnippet }),
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
  async buildMessages() {
    // Grounding is soft: a failed Serper/CoinGecko still yields a draft.
    // Mirror the paid path so the free preview reflects what paying produces.
    let searchSummary: string | null = null;
    try {
      const s = await fetchSerper(SERPER_QUERY, { mode: 'news', recency: 'qdr:d' });
      searchSummary = summarizeSerper(s.organic, s.newsSnippet);
    } catch (e) {
      console.error('[dailyRecap.buildMessages] serper failed, continuing:', e instanceof Error ? e.message : e);
    }
    let marketSnippet: string | null = null;
    try {
      marketSnippet = joinSnippet(await fetchMarketOverview(), await defiLine());
    } catch (e) {
      console.error('[dailyRecap.buildMessages] market overview failed, continuing:', e instanceof Error ? e.message : e);
    }
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: buildDailyRecapPrompt({ searchSummary, marketSnippet }) },
    ];
    return { messages, temperature: 0.8, maxTokens: 1400 };
  },
  async preview(input) {
    const draft = await dailyRecapMode.buildMessages(input);
    return { tweets: draft ? await generateTweets(draft) : [] };
  },
};
