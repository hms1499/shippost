// Isomorphic funnel vocabulary shared by the client emitter (lib/funnel.ts),
// the ingest route, and the report. No 'use client' / no server imports so it
// is safe on both sides.

// Order matters: the report reads conversion as stage[i] / stage[i-1].
//
// CUTOVER 2026-08-19 — 'share' used to fire the moment a thread was delivered,
// so it counted deliveries and sat at ~100% of 'pay' by construction. It now
// fires only when the user says they posted, and 'deliver' takes the slot it
// was occupying. Rows written before that date carry the old meaning: 'share'
// is inflated and 'deliver' is absent for any window reaching back past it.
export const FUNNEL_STAGES = [
  'visit',
  'connect',
  'mode_select',
  'submit',
  'preview',
  'pay',
  'deliver',
  'share',
  'receipt_copied',
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// Acquisition source, append-only whitelist. 'x' = arrived via an X share link
// (?ref=x). Adding a source here needs no DB migration (the column is free text).
export const FUNNEL_SOURCES = ['x'] as const;
export type FunnelSource = (typeof FUNNEL_SOURCES)[number];

export function isFunnelSource(v: unknown): v is FunnelSource {
  return typeof v === 'string' && (FUNNEL_SOURCES as readonly string[]).includes(v);
}

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export function isFunnelStage(v: unknown): v is FunnelStage {
  return typeof v === 'string' && (FUNNEL_STAGES as readonly string[]).includes(v);
}

export function isValidMode(v: unknown): v is 0 | 1 | 2 | 3 | 4 | 5 | null | undefined {
  return (
    v === null || v === undefined || v === 0 || v === 1 || v === 2 || v === 3 || v === 4 || v === 5
  );
}

// The wire shape the client sends and the ingest route validates.
export interface FunnelEventInput {
  session_id: string;
  stage: FunnelStage;
  mode?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  chain_id?: number | null;
  wallet_address?: string | null;
  source?: FunnelSource | null;
}
