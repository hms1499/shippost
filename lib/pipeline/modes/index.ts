// lib/pipeline/modes/index.ts
import type { ModeDef } from './types';
import { educationalMode } from './educational';
import { hotTakeMode } from './hotTake';

export type { ModeDef, ModeInputBody, UnifiedModeOutput, Emit } from './types';

export const MODES: Record<number, ModeDef> = {
  [educationalMode.id]: educationalMode,
  [hotTakeMode.id]: hotTakeMode,
};

export function getMode(id: number | undefined | null): ModeDef | null {
  if (id == null) return null;
  return MODES[id] ?? null;
}
