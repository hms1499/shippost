// lib/pipeline/modes/educational.ts
import { runModeA, educationalQuery } from '@/lib/pipeline/runModeA';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeAPrompt } from '@/lib/prompts/modeA';
import { summarizeSerper } from '@/lib/prompts/modeB';
import { generateTweets } from '@/lib/pipeline/generateDraft';
import { fetchSerper } from '@/lib/pipeline/serperStep';
import type { ModeDef } from './types';

const VALID_AUDIENCES = ['beginner', 'intermediate', 'advanced'] as const;

export const educationalMode: ModeDef = {
  id: 0,
  key: 'educational',
  validateInput(b) {
    if (!b.topic?.trim()) return 'topic required for Mode A';
    if (b.audience && !VALID_AUDIENCES.includes(b.audience)) return 'invalid audience';
    return null;
  },
  async run(ctx, _body, emit) {
    // runModeA now grounds on a soft, paid Serper search before drafting, so
    // its total covers Groq plus the grounding settle when it lands.
    const { tweets, totalCostUsd, searchSummary } = await runModeA(ctx, emit);
    return { tweets, totalCostUsd, searchSummary, marketSnippet: null };
  },
  async preview(input) {
    // Grounding is soft: a failed Serper still yields a draft. Mirror the paid
    // path so the free preview reflects what paying produces. Guests skip
    // Serper entirely — the landing taste must not drain the shared quota.
    const topic = input.topic ?? '';
    let searchSummary: string | null = null;
    if (!input.skipGrounding) {
      try {
        const s = await fetchSerper(educationalQuery(topic));
        searchSummary = summarizeSerper(s.organic, s.newsSnippet);
      } catch (e) {
        console.error('[educational.preview] serper failed, continuing:', e instanceof Error ? e.message : e);
      }
    }
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildModeAPrompt({ topic, audience: input.audience ?? 'beginner', searchSummary }),
      },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.7, maxTokens: 1200 }) };
  },
};
