// lib/pipeline/modes/hotTake.ts
import { runModeB } from '@/lib/pipeline/runModeB';
import type { Angle } from '@/lib/prompts/modeB';
import type { ModeDef } from './types';

const VALID_ANGLES: Angle[] = ['bullish', 'bearish', 'skeptical'];

export const hotTakeMode: ModeDef = {
  id: 1,
  key: 'hotTake',
  validateInput(b) {
    if (!b.eventDescription?.trim()) return 'eventDescription required for Mode B';
    if (b.angle && !VALID_ANGLES.includes(b.angle)) return 'invalid angle';
    return null;
  },
  async run(ctx, body, emit) {
    const out = await runModeB(
      { ...ctx, angle: body.angle ?? 'skeptical', eventDescription: body.eventDescription ?? '' },
      emit,
    );
    return {
      tweets: out.tweets,
      totalCostUsd: out.totalCostUsd,
      searchSummary: out.searchSummary,
      marketSnippet: out.marketSnippet,
    };
  },
};
