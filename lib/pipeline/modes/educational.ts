// lib/pipeline/modes/educational.ts
import { runModeA, MODE_A_TOTAL_COST_USD } from '@/lib/pipeline/runModeA';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeAPrompt } from '@/lib/prompts/modeA';
import { generateTweets } from '@/lib/pipeline/generateDraft';
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
    const { tweets } = await runModeA(ctx, emit);
    // Mode A is a single Groq settle, so its total is exactly the Groq cost.
    return { tweets, totalCostUsd: MODE_A_TOTAL_COST_USD, searchSummary: null, marketSnippet: null };
  },
  async preview(input) {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildModeAPrompt({ topic: input.topic ?? '', audience: input.audience ?? 'beginner' }),
      },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.7, maxTokens: 1200 }) };
  },
};
