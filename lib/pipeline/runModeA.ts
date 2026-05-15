import { runGroqStep, GROQ_COST_HUMAN } from './groqStep';
import type { PipelineContext, PipelineEvent } from './types';

export interface ModeAOutput {
  tweets: string[];
}

// Mode A is a single Groq settle, so its total is exactly the Groq cost.
export const MODE_A_TOTAL_COST_USD = GROQ_COST_HUMAN;

export async function runModeA(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<ModeAOutput> {
  const { tweets } = await runGroqStep(ctx, emit);
  return { tweets };
}
