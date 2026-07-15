/**
 * Funnel report — per-mode drop-off across the funnel stages, read from
 * funnel_events. Answers "does each mode (esp. Comparison, mode 4) get used,
 * and where do users drop off?"
 *
 * Metric is DISTINCT SESSIONS per stage (deduped by session_id) — the same
 * definition the app's /api/admin/funnel uses (lib/funnelReport.computeFunnel),
 * so this script and that endpoint never disagree. Raw event counts would
 * inflate stages a session can re-emit (e.g. reopening the mode picker).
 *
 * Prereqs: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE in env (point at
 * prod to report prod). Mode-4 rows only exist after migration 0009 is applied.
 *
 * Run:
 *   pnpm funnel:report              # last 30 days
 *   pnpm funnel:report --days=7
 */
import 'dotenv/config';
import { getSupabaseServer } from '../lib/supabase';
import { computeFunnel, type FunnelRow } from '../lib/funnelReport';
import { FUNNEL_STAGES } from '../lib/funnelTypes';

const MODE_LABEL: Record<number, string> = {
  0: 'Educational',
  1: 'Hot Take',
  2: 'Token Analysis',
  3: 'Daily Recap',
  4: 'Comparison',
};

// The stages that carry a mode (connect + receipt_copied are mode-less and only
// appear in the overall breakdown, never in a per-mode row).
const MODE_STAGES = ['mode_select', 'submit', 'preview', 'pay', 'share'] as const;

function parseDays(argv: string[]): number {
  for (const a of argv) {
    if (a.startsWith('--days=')) {
      const n = Number(a.slice('--days='.length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return 30;
}

async function main() {
  const days = parseDays(process.argv.slice(2));
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('funnel_events')
    .select('session_id, stage, mode')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error.message);
    process.exit(2);
  }
  const rows = (data ?? []) as FunnelRow[];
  const report = computeFunnel(rows);

  console.log(`Funnel over last ${days} day(s) — ${rows.length} events, distinct sessions per stage (since ${cutoff.slice(0, 10)}):\n`);

  console.log('overall:');
  for (const s of FUNNEL_STAGES) {
    console.log(`  ${s.padEnd(13)} ${report.perStage[s]}`);
  }
  console.log('');

  for (let mode = 0; mode <= 4; mode++) {
    const counts = report.byMode[mode as 0 | 1 | 2 | 3 | 4];
    const cells = MODE_STAGES.map((s) => `${s} ${counts[s]}`);
    const flag = mode === 4 ? '  ← Comparison' : '';
    console.log(`mode ${mode} ${MODE_LABEL[mode].padEnd(15)} | ${cells.join('  ')}${flag}`);
  }

  const mode4 = report.byMode[4];
  const mode4Reached = MODE_STAGES.some((s) => mode4[s] > 0);
  console.log(`\nComparison (mode 4): ${mode4Reached ? 'in use' : 'no sessions yet in this window'}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
