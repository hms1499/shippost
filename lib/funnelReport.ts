import { FUNNEL_STAGES, type FunnelStage } from './funnelTypes';

export interface FunnelRow {
  session_id: string;
  stage: string;
  mode: number | null;
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
  // byMode[0|1|2|3|4] = per-stage distinct sessions for rows with that mode.
  byMode: Record<0 | 1 | 2 | 3 | 4, StageCounts>;
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
  } as Record<0 | 1 | 2 | 3 | 4, StageCounts>;

  return { perStage, conversion, byMode };
}
