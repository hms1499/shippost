// lib/pipeline/modes/types.ts
import type { PipelineContext, PipelineEvent } from '@/lib/pipeline/types';
import type { Audience } from '@/lib/prompts/modeA';
import type { Angle } from '@/lib/prompts/modeB';
import type { EventContext } from '@/lib/eventContext';

export type Emit = (e: PipelineEvent) => void;

// The mode-relevant subset of the request body. Structurally compatible with
// the route's StreamRequest, so the route passes its body straight through.
export interface ModeInputBody {
  mode?: number;
  topic?: string;
  audience?: Audience;
  eventDescription?: string;
  angle?: Angle;
  // Mode B only: OG metadata for a pasted URL, forwarded from the client so the
  // agent reads the article's substance, not the raw URL string.
  eventContext?: EventContext | null;
}

// Every mode normalises its result to this shape so the route can persist and
// stream uniformly, no matter how many grounding steps the mode ran.
export interface UnifiedModeOutput {
  tweets: string[];
  totalCostUsd: string;
  searchSummary: string | null;
  marketSnippet: string | null;
}

// Free-preview input. Settle-free: produces a draft without paying anything.
export interface PreviewInput {
  mode: number;
  topic?: string;
  audience?: Audience;
  eventDescription?: string;
  angle?: Angle;
  eventContext?: EventContext | null;
  // Guest landing only: skip Serper so anonymous traffic cannot drain the
  // shared search quota. Connected previews keep grounding.
  skipGrounding?: boolean;
}

export interface ModeDef {
  // MUST equal the uint8 emitted on-chain in ThreadRequested. Append-only —
  // never renumber an existing mode (see plan "Invariants").
  id: number;
  key: string;
  // Returns null when valid, else a 400 message. No paid work runs if non-null.
  validateInput(body: ModeInputBody): string | null;
  // Runs the paid pipeline. Settle MUST gate every content emit (we only move
  // the existing runModeA/runModeB calls here, never reorder their internals).
  run(ctx: PipelineContext, body: ModeInputBody, emit: Emit): Promise<UnifiedModeOutput>;
  // Settle-free draft for the free preview. MUST never settle, spend from the
  // agent wallet, or persist a row (a source-guard test enforces this).
  preview(input: PreviewInput): Promise<{ tweets: string[] }>;
}
