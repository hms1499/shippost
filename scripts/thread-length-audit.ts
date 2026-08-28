/**
 * Thread length audit — how often does a delivered thread contain a tweet X
 * would refuse, and would fitThread have fixed it?
 *
 * This exists because the 280-char problem has only ever been eyeballed. Run it
 * BEFORE wiring fitThread into the pipeline to get a baseline, and again after,
 * so "it got better" is a measurement rather than an impression.
 *
 * Three numbers matter:
 *   - over-limit rate: share of delivered threads with at least one bad tweet
 *   - fixable: how many of those fitThread repairs with no loss of content
 *   - unfixable: no sentence seam, so the fix stays a human edit. This is the
 *     number that decides whether a compression step is ever worth building.
 *
 * Reads only completed threads: a pending or failed row was never delivered, so
 * its draft says nothing about what users actually received.
 *
 * Prereqs: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE in env (point at
 * prod to report prod). Read-only — this script never writes.
 *
 * Run:
 *   pnpm audit:length              # last 90 days
 *   pnpm audit:length --days=30
 *   pnpm audit:length --days=0     # all time
 */
import 'dotenv/config';
import { getSupabaseServer } from '../lib/supabase';
import { fitThread } from '../lib/threadShape';
import { TWEET_MAX_CHARS } from '../lib/threadParser';

const MODE_LABEL: Record<number, string> = {
  0: 'Educational',
  1: 'Hot Take',
  2: 'Token Analysis',
  3: 'Daily Recap',
  4: 'Comparison',
  5: 'News Breakdown',
};

interface ThreadRow {
  id: number;
  mode: number;
  tweets: unknown;
  created_at: string;
}

function parseDays(): number {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  if (!arg) return 90;
  const n = Number(arg.slice('--days='.length));
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad --days: ${arg}`);
  return n;
}

/** Tweets as a string[], or null for a row whose jsonb is missing or malformed.
 *  Counted separately rather than coerced — a row we cannot read is not a row
 *  with no problem. */
function asTweets(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  if (!raw.every((t) => typeof t === 'string')) return null;
  return raw as string[];
}

const pct = (n: number, total: number) => (total === 0 ? '—' : `${((n / total) * 100).toFixed(1)}%`);

async function main() {
  const days = parseDays();
  const supabase = getSupabaseServer();

  let query = supabase
    .from('threads')
    .select('id, mode, tweets, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (days > 0) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', since);
  }

  const { data, error } = await query;
  if (error) throw new Error(`supabase: ${error.message}`);
  const rows = (data ?? []) as ThreadRow[];

  const window = days > 0 ? `last ${days} days` : 'all time';
  console.log(`\nThread length audit — ${rows.length} completed threads, ${window}`);
  console.log(`Limit: ${TWEET_MAX_CHARS} chars (JS length; see threadParser.ts:38)\n`);

  if (rows.length === 0) {
    console.log('No completed threads in this window.\n');
    return;
  }

  let unreadable = 0;
  let threadsOver = 0;
  let threadsFullyFixable = 0;
  let threadsPartlyFixable = 0;
  let tweetsTotal = 0;
  let tweetsOver = 0;
  let tweetsUnfixable = 0;
  const overages: number[] = [];
  const perMode = new Map<number, { threads: number; over: number; unfixable: number }>();

  for (const row of rows) {
    const tweets = asTweets(row.tweets);
    if (!tweets || tweets.length === 0) {
      unreadable += 1;
      continue;
    }

    const mode = perMode.get(row.mode) ?? { threads: 0, over: 0, unfixable: 0 };
    mode.threads += 1;

    tweetsTotal += tweets.length;
    const bad = tweets.filter((t) => t.length > TWEET_MAX_CHARS);
    tweetsOver += bad.length;
    for (const t of bad) overages.push(t.length - TWEET_MAX_CHARS);

    if (bad.length > 0) {
      threadsOver += 1;
      mode.over += 1;

      // The counterfactual: what the pipeline would have delivered instead.
      const { unfixable } = fitThread(tweets);
      tweetsUnfixable += unfixable.length;
      if (unfixable.length === 0) threadsFullyFixable += 1;
      else {
        threadsPartlyFixable += 1;
        mode.unfixable += 1;
      }
    }
    perMode.set(row.mode, mode);
  }

  const readable = rows.length - unreadable;
  console.log('DELIVERED');
  console.log(`  threads read           ${readable}${unreadable ? `  (${unreadable} unreadable, skipped)` : ''}`);
  console.log(`  threads over limit     ${threadsOver}  (${pct(threadsOver, readable)})`);
  console.log(`  tweets over limit      ${tweetsOver} of ${tweetsTotal}  (${pct(tweetsOver, tweetsTotal)})`);

  if (overages.length > 0) {
    overages.sort((a, b) => a - b);
    const median = overages[Math.floor(overages.length / 2)];
    console.log(`  overage min/med/max    ${overages[0]} / ${median} / ${overages[overages.length - 1]} chars`);
  }

  console.log('\nCOUNTERFACTUAL (fitThread applied)');
  console.log(`  fully repaired         ${threadsFullyFixable} threads  (${pct(threadsFullyFixable, threadsOver)} of the bad ones)`);
  console.log(`  still over after fit   ${threadsPartlyFixable} threads`);
  console.log(`  tweets with no seam    ${tweetsUnfixable} of ${tweetsOver}  (${pct(tweetsUnfixable, tweetsOver)})`);
  console.log('  ^ that last line is the size of the residual a compression step would target.');

  const modes = [...perMode.entries()].sort((a, b) => a[0] - b[0]);
  if (modes.length > 0) {
    console.log('\nBY MODE');
    for (const [id, m] of modes) {
      const label = (MODE_LABEL[id] ?? `mode ${id}`).padEnd(15);
      console.log(`  ${label} ${String(m.threads).padStart(4)} threads   ${String(m.over).padStart(3)} over (${pct(m.over, m.threads).padStart(6)})   ${m.unfixable} unfixable`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
