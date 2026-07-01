import { runGroqStep } from './groqStep';
import { runSerperStep } from './serperStep';
import { summarizeSerper } from '@/lib/prompts/modeB';
import { GROQ_COST_HUMAN } from './groqCost';
import type { PipelineContext, PipelineEvent } from './types';

export interface ModeAOutput {
  tweets: string[];
  searchSummary: string | null;
  totalCostUsd: string;
}

// Kept for callers/tests that want the floor cost of a Mode A run (the Groq
// settle). The real total is returned dynamically by runModeA, since the
// grounding Serper step is soft and may or may not settle.
export const MODE_A_TOTAL_COST_USD = GROQ_COST_HUMAN;

// Educational concepts are evergreen, so the query is the raw topic anchored to
// the domain — no recency window (that's for market/event threads).
export function educationalQuery(topic: string): string {
  return `${topic.trim()} ethereum`;
}

export async function runModeA(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<ModeAOutput> {
  let totalCost = 0;
  const wrappedEmit = (e: PipelineEvent) => {
    if (e.type === 'step_settled') {
      const c = parseFloat(e.costAmount);
      if (!Number.isNaN(c)) totalCost += c;
    }
    emit(e);
  };

  // Grounding — soft-fail paid Serper search. Anchors concrete specifics
  // (EIP numbers, signatures, dates) without dictating the explanation. A
  // failed fetch or settle degrades to an ungrounded draft, never blocks it.
  let searchSummary: string | null = null;
  try {
    const s = await runSerperStep({ ...ctx, query: educationalQuery(ctx.topic) }, wrappedEmit);
    searchSummary = summarizeSerper(s.organic, s.newsSnippet);
  } catch (e) {
    console.error('[runModeA] serper failed, continuing ungrounded:', e);
    emit({ type: 'step_failed', step: 'serper', error: e instanceof Error ? e.message : 'search failed' });
  }

  // Draft — HARD-fail (strict-settle, no thread = no value).
  const { tweets } = await runGroqStep(ctx, wrappedEmit, { searchSummary });

  return { tweets, searchSummary, totalCostUsd: totalCost.toFixed(3) };
}
