import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeAPrompt } from '@/lib/prompts/modeA';
import { generateDraft, type DraftResult } from './generateDraft';
import type { PipelineContext, PipelineEvent } from './types';

export async function runGroqStep(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
  opts: { searchSummary?: string | null } = {},
): Promise<{ tweets: string[] }> {
  emit({ type: 'step_started', step: 'groq' });

  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: buildModeAPrompt({
        topic: ctx.topic,
        audience: ctx.audience,
        searchSummary: opts.searchSummary ?? null,
      }),
    },
  ];

  let draft: DraftResult;
  try {
    draft = await generateDraft(ctx, { messages, temperature: 0.7, maxTokens: 1200 });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'groq step failed';
    emit({ type: 'step_failed', step: 'groq', error: msg });
    throw e;
  }

  emit({
    type: 'step_settled',
    step: 'groq',
    txHash: draft.txHash,
    costAmount: draft.costHuman,
    tokenSymbol: draft.tokenSymbol,
  });
  emit({ type: 'step_output', step: 'groq', output: draft.tweets });
  return { tweets: draft.tweets };
}
