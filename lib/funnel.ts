'use client';

import { FunnelStage, FunnelEventInput, isFunnelSource, type FunnelSource } from './funnelTypes';

const ENDPOINT = '/api/public/funnel';
const SID_KEY = 'coinop.funnel.sid';
const SOURCE_KEY = 'coinop.funnel.source';

let cachedSid: string | null = null;

// Test-only: clear the module-level session cache between cases.
export function __resetSessionIdForTests(): void {
  cachedSid = null;
}

function getSessionId(): string | null {
  if (cachedSid) return cachedSid;
  try {
    const existing = sessionStorage.getItem(SID_KEY);
    if (existing) {
      cachedSid = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(SID_KEY, fresh);
    cachedSid = fresh;
    return fresh;
  } catch {
    return null; // storage blocked → don't track rather than crash
  }
}

function getStoredSource(): FunnelSource | null {
  try {
    const v = sessionStorage.getItem(SOURCE_KEY);
    return isFunnelSource(v) ? v : null;
  } catch {
    return null;
  }
}

// First-touch acquisition capture. Reads ?ref from the URL, whitelists it, and
// persists it for the session so every later event can be attributed. An
// already-stored source is never overwritten. Safe to call on every mount.
export function captureSource(): FunnelSource | null {
  try {
    if (typeof window === 'undefined') return null;
    const existing = getStoredSource();
    if (existing) return existing;
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (!isFunnelSource(ref)) return null;
    sessionStorage.setItem(SOURCE_KEY, ref);
    return ref;
  } catch {
    return null;
  }
}

export function buildPayload(
  sessionId: string,
  stage: FunnelStage,
  opts: { mode?: number | null; chainId?: number | null; wallet?: string | null; source?: FunnelSource | null } = {},
): FunnelEventInput {
  const payload: FunnelEventInput = { session_id: sessionId, stage };
  if (opts.mode === 0 || opts.mode === 1 || opts.mode === 2 || opts.mode === 3 || opts.mode === 4 || opts.mode === 5) payload.mode = opts.mode;
  if (typeof opts.chainId === 'number') payload.chain_id = opts.chainId;
  if (opts.wallet) payload.wallet_address = opts.wallet.toLowerCase();
  if (isFunnelSource(opts.source)) payload.source = opts.source;
  return payload;
}

// Fire-and-forget. Survives navigation/unload via sendBeacon; falls back to
// keepalive fetch. Any failure (SSR, blocked storage, network) is swallowed —
// analytics must never break the flow.
export function track(
  stage: FunnelStage,
  opts: { mode?: number | null; chainId?: number | null; wallet?: string | null } = {},
): void {
  try {
    if (typeof window === 'undefined') return;
    const sid = getSessionId();
    if (!sid) return;
    const body = JSON.stringify(
      buildPayload(sid, stage, { ...opts, source: getStoredSource() }),
    );

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {});
  } catch {
    // swallow
  }
}
