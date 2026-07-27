import type { SpendReadiness } from './agent/walletHealth';

export type { SpendReadiness };
export type SpendBlockReason = Extract<SpendReadiness, { ok: false }>['reason'];

// A preflight must never be the reason a user can't pay, so it is bounded and
// every failure mode below answers "ready". The real guarantee lives on the
// server; this is the client's chance to avoid opening the wallet sheet for a
// run that provably cannot settle.
const TIMEOUT_MS = 4_000;

export async function fetchSpendReadiness(tokenSymbol: string): Promise<SpendReadiness> {
  try {
    const res = await fetch(`/api/preflight?token=${encodeURIComponent(tokenSymbol)}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: true };
    const body = (await res.json()) as unknown;
    return parseReadiness(body);
  } catch {
    // Offline, aborted, or malformed — fail open.
    return { ok: true };
  }
}

// Only a well-formed "not ready" blocks the flow. Anything else reads as ready,
// so a shape change on the server can never strand users on a blocked screen.
function parseReadiness(body: unknown): SpendReadiness {
  if (typeof body !== 'object' || body === null) return { ok: true };
  const b = body as { ok?: unknown; reason?: unknown };
  if (b.ok !== false) return { ok: true };
  return b.reason === 'paused' || b.reason === 'gas' || b.reason === 'cap'
    ? { ok: false, reason: b.reason }
    : { ok: true };
}
