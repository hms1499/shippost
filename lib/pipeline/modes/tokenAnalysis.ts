// lib/pipeline/modes/tokenAnalysis.ts
import { runModeB } from '@/lib/pipeline/runModeB';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { summarizeSerper, summarizeMarket, type Angle } from '@/lib/prompts/modeB';
import { buildTokenAnalysisPrompt, normalizeTicker } from '@/lib/prompts/tokenAnalysis';
import { generateTweets } from '@/lib/pipeline/generateDraft';
import { fetchSerper } from '@/lib/pipeline/serperStep';
import { fetchCoinGecko, runCoinGeckoStep } from '@/lib/pipeline/coingeckoStep';
import { fetchProtocolTvl, summarizeProtocolTvl } from '@/lib/pipeline/defiLlamaStep';
import type { ModeDef } from './types';

const VALID_ANGLES: Angle[] = ['bullish', 'bearish', 'skeptical'];

// Token-oriented search query so Serper surfaces price catalysts / news rather
// than generic results.
function serperQueryFor(ticker: string): string {
  return `${ticker} crypto token price news catalyst`;
}

const joinSnippet = (...parts: (string | null)[]): string | null =>
  parts.filter(Boolean).join('\n') || null;

// On-chain TVL context (DefiLlama), soft: returns null for non-protocol tokens
// or on any failure so the thread still ships on CoinGecko grounding alone.
async function tvlLineFor(ticker: string, mcapUsd: number | null): Promise<string | null> {
  try {
    return summarizeProtocolTvl(await fetchProtocolTvl(ticker), mcapUsd);
  } catch (e) {
    console.error('[tokenAnalysis] defillama failed, continuing:', e instanceof Error ? e.message : e);
    return null;
  }
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
        // Bias toward recent catalysts/news for the token, not stale pages.
        serperOpts: { recency: 'qdr:m' },
        // Fold DefiLlama TVL into the CoinGecko market step (same free,
        // no-settle 'coingecko' lifecycle) so the prompt sees on-chain capital
        // alongside price/momentum.
        marketStep: async (c, emit) => {
          const cg = await runCoinGeckoStep(c, emit);
          return joinSnippet(summarizeMarket(cg), await tvlLineFor(ticker, cg.marketCapUsd));
        },
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
  async buildMessages(input) {
    const ticker = normalizeTicker(input.topic ?? '');
    const angle = input.angle ?? 'skeptical';
    // Grounding is soft: a failed Serper/CoinGecko still yields a draft.
    let searchSummary: string | null = null;
    try {
      const s = await fetchSerper(serperQueryFor(ticker), { recency: 'qdr:m' });
      searchSummary = summarizeSerper(s.organic, s.newsSnippet);
    } catch (e) {
      console.error('[tokenAnalysis.buildMessages] serper failed, continuing:', e instanceof Error ? e.message : e);
    }
    let marketSnippet: string | null = null;
    try {
      const cg = await fetchCoinGecko(ticker);
      marketSnippet = joinSnippet(summarizeMarket(cg), await tvlLineFor(ticker, cg.marketCapUsd));
    } catch (e) {
      console.error('[tokenAnalysis.buildMessages] coingecko failed, continuing:', e instanceof Error ? e.message : e);
    }
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: buildTokenAnalysisPrompt({ ticker, angle, searchSummary, marketSnippet }) },
    ];
    return { messages, temperature: 0.8, maxTokens: 1400 };
  },
  async preview(input) {
    const draft = await tokenAnalysisMode.buildMessages(input);
    return { tweets: draft ? await generateTweets(draft) : [] };
  },
};
