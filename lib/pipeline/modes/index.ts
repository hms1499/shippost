// lib/pipeline/modes/index.ts
import type { ModeDef } from './types';
import { educationalMode } from './educational';
import { hotTakeMode } from './hotTake';
import { tokenAnalysisMode } from './tokenAnalysis';

export type { ModeDef, ModeInputBody, UnifiedModeOutput, PreviewInput, Emit } from './types';

export const MODES: Record<number, ModeDef> = {
  [educationalMode.id]: educationalMode,
  [hotTakeMode.id]: hotTakeMode,
  [tokenAnalysisMode.id]: tokenAnalysisMode,
};

export function getMode(id: number | undefined | null): ModeDef | null {
  if (id == null) return null;
  return MODES[id] ?? null;
}
