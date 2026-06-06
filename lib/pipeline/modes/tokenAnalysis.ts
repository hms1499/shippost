// lib/pipeline/modes/tokenAnalysis.ts
import { runModeB } from '@/lib/pipeline/runModeB';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { summarizeSerper, summarizeMarket, type Angle } from '@/lib/prompts/modeB';
import { buildTokenAnalysisPrompt, normalizeTicker } from '@/lib/prompts/tokenAnalysis';
import { generateTweets } from '@/lib/pipeline/generateDraft';
import { fetchSerper } from '@/lib/pipeline/serperStep';
import { fetchCoinGecko } from '@/lib/pipeline/coingeckoStep';
import type { ModeDef } from './types';

const VALID_ANGLES: Angle[] = ['bullish', 'bearish', 'skeptical'];

// Token-oriented search query so Serper surfaces price catalysts / news rather
// than generic results.
function serperQueryFor(ticker: string): string {
  return `${ticker} crypto token price news catalyst`;
}

export const tokenAnalysisMode: ModeDef = {
  id: 2,
  key: 'tokenAnalysis',
  validateInput(b) {
    // The ticker rides in on `topic` (no new body field, no route change).
    if (!b.topic?.trim()) return 'token ticker required for Token Analysis';
    if (b.angle && !VALID_ANGLES.includes(b.angle)) return 'invalid angle';
    return null;
  },
  async run(ctx, body, emit) {
    const ticker = normalizeTicker(body.topic ?? '');
    const angle = body.angle ?? 'skeptical';
    // Reuse runModeB's vetted grounded pipeline; only the query + prompt differ.
    const out = await runModeB(
      {
        ...ctx,
        topic: ticker, // CoinGecko extracts the $cashtag from ctx.topic
        eventDescription: ticker, // fallback only; query + prompt are overridden
        angle,
        serperQuery: serperQueryFor(ticker),
        buildPrompt: ({ searchSummary, marketSnippet }) =>
          buildTokenAnalysisPrompt({ ticker, angle, searchSummary, marketSnippet }),
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
    const ticker = normalizeTicker(input.topic ?? '');
    const angle = input.angle ?? 'skeptical';
    // Grounding is soft: a failed Serper/CoinGecko still yields a draft.
    let searchSummary: string | null = null;
    try {
      const s = await fetchSerper(serperQueryFor(ticker));
      searchSummary = summarizeSerper(s.organic, s.newsSnippet);
    } catch (e) {
      console.error('[tokenAnalysis.preview] serper failed, continuing:', e instanceof Error ? e.message : e);
    }
    let marketSnippet: string | null = null;
    try {
      marketSnippet = summarizeMarket(await fetchCoinGecko(ticker));
    } catch (e) {
      console.error('[tokenAnalysis.preview] coingecko failed, continuing:', e instanceof Error ? e.message : e);
    }
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: buildTokenAnalysisPrompt({ ticker, angle, searchSummary, marketSnippet }) },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.8, maxTokens: 1400 }) };
  },
};
