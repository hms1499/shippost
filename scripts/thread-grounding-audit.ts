/**
 * Grounding audit — how often does a delivered thread get built without its
 * live data, and did anyone notice?
 *
 * The user is already told: a failed Serper/CoinGecko step emits step_failed
 * (runModeA.ts:46, runModeB.ts:63 and :78), which HomeClient turns into a
 * "Built without live data" notice and a partial-refund button. What is missing
 * is the operator's half — those failures are console.error only, so nobody
 * knows the RATE. This reads it back out of what was persisted.
 *
 * The signal: a completed thread stores the grounding it actually used
 * (stream/route.ts:316). An empty search_summary on a completed row means the
 * thread shipped ungrounded.
 *
 * Mode-aware on purpose. Mode 0 (Educational) runs through runModeA, which has
 * no market step at all, so its market_snippet is ALWAYS empty and counting
 * that as degradation would invent a problem. Only modes 1-5 (runModeB) have
 * one to lose.
 *
 * Prereqs: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE in env (point at
 * prod to report prod). Read-only.
 *
 * Run:
 *   pnpm audit:grounding
 *   pnpm audit:grounding --days=30
 *   pnpm audit:grounding --days=0     # all time
 */
import 'dotenv/config';
import { getSupabaseServer } from '../lib/supabase';
import { extractSymbol } from '../lib/pipeline/coingeckoStep';

const MODE_LABEL: Record<number, string> = {
  0: 'Educational',
  1: 'Hot Take',
  2: 'Token Analysis',
  3: 'Daily Recap',
  4: 'Comparison',
  5: 'News Breakdown',
};

/** What an empty market_snippet MEANS, per mode. Getting this wrong is how an
 *  audit invents a problem:
 *
 *   - mode 0 runs runModeA, which has no market step at all -> always empty.
 *   - modes 1 and 5 look the token up from the user's free text with a $CASHTAG
 *     (coingeckoStep.ts extractSymbol). No cashtag, no lookup, no snippet — and
 *     nothing failed. Only a thread whose text DID name a token can be said to
 *     have lost anything.
 *   - modes 2, 3, 4 always have something to fetch (a normalised ticker, the
 *     whole-market overview, chain TVL), so empty there is a real loss. */
type MarketKind = 'none' | 'cashtag' | 'always';
const MARKET_KIND = (mode: number): MarketKind =>
  mode === 0 ? 'none' : mode === 1 || mode === 5 ? 'cashtag' : 'always';

interface Row {
  id: number;
  mode: number;
  topic: string | null;
  search_summary: string | null;
  market_snippet: string | null;
  serper_tx_hash: string | null;
  created_at: string;
}

function parseDays(): number {
  const arg = process.argv.find((a) => a.startsWith('--days='));
  if (!arg) return 90;
  const n = Number(arg.slice('--days='.length));
  if (!Number.isFinite(n) || n < 0) throw new Error(`bad --days: ${arg}`);
  return n;
}

// Empty string counts as missing: summarizeSerper can return one when the
// search came back with nothing usable, which is the same outcome as a throw.
const missing = (v: string | null) => !v || v.trim().length === 0;
const pct = (n: number, total: number) => (total === 0 ? '—' : `${((n / total) * 100).toFixed(1)}%`);

async function main() {
  const days = parseDays();
  const supabase = getSupabaseServer();

  let query = supabase
    .from('threads')
    .select('id, mode, topic, search_summary, market_snippet, serper_tx_hash, created_at')
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  if (days > 0) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', since);
  }

  const { data, error } = await query;
  if (error) throw new Error(`supabase: ${error.message}`);
  const rows = (data ?? []) as Row[];

  const window = days > 0 ? `last ${days} days` : 'all time';
  console.log(`\nGrounding audit — ${rows.length} completed threads, ${window}\n`);

  if (rows.length === 0) {
    console.log('No completed threads in this window.\n');
    return;
  }

  let noSearch = 0;
  let noMarket = 0;
  let marketEligible = 0;
  let neither = 0;
  let noTokenNamed = 0;
  const perMode = new Map<number, { n: number; noSearch: number; noMarket: number }>();

  for (const r of rows) {
    const m = perMode.get(r.mode) ?? { n: 0, noSearch: 0, noMarket: 0 };
    m.n += 1;

    const searchLost = missing(r.search_summary);
    if (searchLost) {
      noSearch += 1;
      m.noSearch += 1;
    }

    let marketLost = false;
    const kind = MARKET_KIND(r.mode);
    // A cashtag mode only had market data to lose if its text named a token.
    const expected =
      kind === 'always' || (kind === 'cashtag' && extractSymbol(r.topic ?? '') !== null);
    if (kind === 'cashtag' && !expected) noTokenNamed += 1;
    if (expected) {
      marketEligible += 1;
      marketLost = missing(r.market_snippet);
      if (marketLost) {
        noMarket += 1;
        m.noMarket += 1;
      }
    }
    if (searchLost && marketLost) neither += 1;
    perMode.set(r.mode, m);
  }

  console.log('DEGRADED DELIVERIES');
  console.log(`  no search context     ${noSearch} of ${rows.length}  (${pct(noSearch, rows.length)})`);
  console.log(`  no market data        ${noMarket} of ${marketEligible}  (${pct(noMarket, marketEligible)})   [only threads that had one to lose]`);
  console.log(`  neither               ${neither} of ${rows.length}  (${pct(neither, rows.length)})`);

  if (noTokenNamed > 0) {
    console.log(`\n  ${noTokenNamed} thread(s) named no $TOKEN, so there was no market lookup to make.`);
    console.log('  Those are NOT counted as degraded — an empty snippet there is normal.');
  }

  const modes = [...perMode.entries()].sort((a, b) => a[0] - b[0]);
  console.log('\nBY MODE');
  for (const [id, m] of modes) {
    const label = (MODE_LABEL[id] ?? `mode ${id}`).padEnd(15);
    const market =
      MARKET_KIND(id) === 'none' ? 'no market step' : `${m.noMarket} lost market`;
    console.log(`  ${label} ${String(m.n).padStart(4)} threads   ${m.noSearch} no search   ${market}`);
  }

  console.log(`\nRead ${rows.length} threads. Treat any percentage above as noise until that number is large.\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
