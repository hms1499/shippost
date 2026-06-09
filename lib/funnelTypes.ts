// Isomorphic funnel vocabulary shared by the client emitter (lib/funnel.ts),
// the ingest route, and the report. No 'use client' / no server imports so it
// is safe on both sides.

export const FUNNEL_STAGES = [
  'connect',
  'mode_select',
  'submit',
  'preview',
  'pay',
  'share',
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export function isFunnelStage(v: unknown): v is FunnelStage {
  return typeof v === 'string' && (FUNNEL_STAGES as readonly string[]).includes(v);
}

export function isValidMode(v: unknown): v is 0 | 1 | 2 | null | undefined {
  return v === null || v === undefined || v === 0 || v === 1 || v === 2;
}

// The wire shape the client sends and the ingest route validates.
export interface FunnelEventInput {
  session_id: string;
  stage: FunnelStage;
  mode?: 0 | 1 | 2 | null;
  chain_id?: number | null;
  wallet_address?: string | null;
}
