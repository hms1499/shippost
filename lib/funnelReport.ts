import { FUNNEL_STAGES, WALLET_RE, type FunnelStage } from './funnelTypes';

export interface FunnelRow {
  session_id: string;
  stage: string;
  mode: number | null;
  // Optional: only the audience split reads it, so callers that don't select
  // the column (and older rows, where it is null) keep working.
  wallet_address?: string | null;
}

/**
 * Parse FUNNEL_INTERNAL_WALLETS ("0xaaa…,0xbbb…") into a lowercased lookup set.
 * Non-wallet junk is dropped rather than throwing: a typo in ops config should
 * narrow the internal set, never break the report.
 */
export function parseInternalWallets(raw: string | undefined | null): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter((w) => WALLET_RE.test(w)),
  );
}

export interface AudienceSplit {
  organic: FunnelRow[];
  internal: FunnelRow[];
}

/**
 * Split rows into organic vs internal (our own dev/test wallets).
 *
 * Classification is per SESSION, not per row: `wallet_address` is only attached
 * from `connect` onward and may be null on later events, so classifying row by
 * row would leak the tail of a dev session into the organic funnel. A session
 * is internal if ANY of its rows carries an allowlisted wallet.
 */
export function partitionByAudience(
  rows: FunnelRow[],
  internalWallets: Set<string>,
): AudienceSplit {
  if (internalWallets.size === 0) return { organic: [...rows], internal: [] };

  const internalSessions = new Set<string>();
  for (const r of rows) {
    const w = r.wallet_address?.toLowerCase();
    if (w && internalWallets.has(w)) internalSessions.add(r.session_id);
  }

  const organic: FunnelRow[] = [];
  const internal: FunnelRow[] = [];
  for (const r of rows) {
    (internalSessions.has(r.session_id) ? internal : organic).push(r);
  }
  return { organic, internal };
}

type StageCounts = Record<FunnelStage, number>;

function emptyStageCounts(): StageCounts {
  return Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as StageCounts;
}

// distinct session_id per stage, from a pre-filtered row set.
function distinctPerStage(rows: FunnelRow[]): StageCounts {
  const seen: Record<string, Set<string>> = {};
  for (const s of FUNNEL_STAGES) seen[s] = new Set();
  for (const r of rows) {
    if ((FUNNEL_STAGES as readonly string[]).includes(r.stage)) {
      seen[r.stage].add(r.session_id);
    }
  }
  const out = emptyStageCounts();
  for (const s of FUNNEL_STAGES) out[s] = seen[s].size;
  return out;
}

export interface FunnelReport {
  perStage: StageCounts;
  // conversion[stage] = perStage[stage] / perStage[previous stage]; first
  // stage and any zero-upstream → 0 (never NaN).
  conversion: StageCounts;
  // byMode[0|1|2|3|4|5] = per-stage distinct sessions for rows with that mode.
  byMode: Record<0 | 1 | 2 | 3 | 4 | 5, StageCounts>;
}

export function computeFunnel(rows: FunnelRow[]): FunnelReport {
  const perStage = distinctPerStage(rows);

  const conversion = emptyStageCounts();
  FUNNEL_STAGES.forEach((stage, i) => {
    if (i === 0) {
      conversion[stage] = 0;
      return;
    }
    const prev = perStage[FUNNEL_STAGES[i - 1]];
    conversion[stage] = prev > 0 ? perStage[stage] / prev : 0;
  });

  const byMode = {
    0: distinctPerStage(rows.filter((r) => r.mode === 0)),
    1: distinctPerStage(rows.filter((r) => r.mode === 1)),
    2: distinctPerStage(rows.filter((r) => r.mode === 2)),
    3: distinctPerStage(rows.filter((r) => r.mode === 3)),
    4: distinctPerStage(rows.filter((r) => r.mode === 4)),
    5: distinctPerStage(rows.filter((r) => r.mode === 5)),
  } as Record<0 | 1 | 2 | 3 | 4 | 5, StageCounts>;

  return { perStage, conversion, byMode };
}
