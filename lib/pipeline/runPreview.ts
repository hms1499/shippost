// Settle-free draft generation for the free preview. Composes the pure
// fetch/generate helpers — it must NEVER settle an x402 call, spend from the
// agent wallet, or persist a thread row (a source-guard test enforces this).
// Returns the full draft; the caller slices the first tweet. Paying regenerates
// fresh via the unchanged paid pipeline.
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeAPrompt, type Audience } from '@/lib/prompts/modeA';
import {
  buildModeBPrompt,
  summarizeSerper,
  summarizeMarket,
  type Angle,
} from '@/lib/prompts/modeB';
import { generateTweets } from './generateDraft';
import { fetchSerper } from './serperStep';
import { fetchCoinGecko } from './coingeckoStep';

export interface PreviewInput {
  mode: 0 | 1;
  topic?: string;
  audience?: Audience;
  eventDescription?: string;
  angle?: Angle;
}

export async function runPreview(input: PreviewInput): Promise<{ tweets: string[] }> {
  if (input.mode === 0) {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildModeAPrompt({ topic: input.topic ?? '', audience: input.audience ?? 'beginner' }),
      },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.7, maxTokens: 1200 }) };
  }

  // Mode B — grounding is soft: a failed Serper/CoinGecko still yields a draft.
  const event = input.eventDescription ?? '';
  let searchSummary: string | null = null;
  try {
    const s = await fetchSerper(event);
    searchSummary = summarizeSerper(s.organic, s.newsSnippet);
  } catch (e) {
    console.error('[runPreview] serper failed, continuing:', e instanceof Error ? e.message : e);
  }
  let marketSnippet: string | null = null;
  try {
    marketSnippet = summarizeMarket(await fetchCoinGecko(event));
  } catch (e) {
    console.error('[runPreview] coingecko failed, continuing:', e instanceof Error ? e.message : e);
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
}
