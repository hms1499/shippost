/**
 * Funnel report — per-mode drop-off across the funnel stages, read from
 * funnel_events. Answers "does each mode (esp. Comparison, mode 4) get used,
 * and where do users drop off?"
 *
 * Prereqs: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env (point at prod to
 * report prod). Mode-4 rows only exist after migration 0009 is applied.
 *
 * Run:
 *   pnpm funnel:report              # last 30 days
 *   pnpm funnel:report --days=7
 */
import 'dotenv/config';
import { getSupabaseServer } from '../lib/supabase';

const MODE_LABEL: Record<number, string> = {
  0: 'Educational',
  1: 'Hot Take',
  2: 'Token Analysis',
  3: 'Daily Recap',
  4: 'Comparison',
};

// Ordered funnel stages that carry a mode (connect is mode-less, counted apart).
const STAGES = ['mode_select', 'submit', 'preview', 'pay', 'share'] as const;

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
    .select('mode, stage, created_at')
    .gte('created_at', cutoff)
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error.message);
    process.exit(2);
  }
  const rows = data ?? [];

  // counts[mode][stage] — mode -1 holds the mode-less `connect` stage.
  const counts = new Map<number, Map<string, number>>();
  const bump = (mode: number, stage: string) => {
    if (!counts.has(mode)) counts.set(mode, new Map());
    const m = counts.get(mode)!;
    m.set(stage, (m.get(stage) ?? 0) + 1);
  };
  for (const r of rows) {
    const mode = r.mode === null || r.mode === undefined ? -1 : Number(r.mode);
    bump(mode, String(r.stage));
  }

  console.log(`Funnel over last ${days} day(s) — ${rows.length} events (since ${cutoff.slice(0, 10)}):\n`);

  const connect = counts.get(-1)?.get('connect') ?? 0;
  console.log(`connect (wallet, mode-less): ${connect}\n`);

  for (let mode = 0; mode <= 4; mode++) {
    const m = counts.get(mode);
    const cells = STAGES.map((s) => `${s} ${m?.get(s) ?? 0}`);
    const label = MODE_LABEL[mode];
    const flag = mode === 4 ? '  ← Comparison' : '';
    console.log(`mode ${mode} ${label.padEnd(15)} | ${cells.join('  ')}${flag}`);
  }

  const mode4Total = [...(counts.get(4)?.values() ?? [])].reduce((a, b) => a + b, 0);
  console.log(`\nComparison (mode 4) total events: ${mode4Total}` +
    (mode4Total === 0 ? '  — none yet (is migration 0009 applied on this DB?)' : ''));
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
