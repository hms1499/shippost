import { runGroqStep } from './groqStep';
import type { PipelineContext, PipelineEvent } from './types';

export interface ModeAOutput {
  tweets: string[];
}

export const MODE_A_TOTAL_COST_USD = '0.001';

export async function runModeA(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<ModeAOutput> {
  const { tweets } = await runGroqStep(ctx, emit);
  return { tweets };
}
