/**
 * Thread length sampler — generate real threads through the real prompts and
 * measure how often the model breaks the 280-char limit, and how much of that
 * fitThread repairs.
 *
 * This is the companion to thread-length-audit.ts. That one reads what users
 * actually received (accurate, but the table holds too few rows to conclude
 * anything). This one manufactures a corpus on demand, which is the only way to
 * get a number today.
 *
 * BEFORE and AFTER come from the SAME completion — completeThread gives the raw
 * parsed thread, fitThread gives the delivered one. Generating twice would
 * measure the model's run-to-run variance instead of the fit.
 *
 * Prompts come from each mode's own buildMessages(), grounding included, so a
 * prompt change is reflected here automatically. Nothing is rebuilt by hand:
 * a harness running a stale copy of a prompt reports confidently wrong numbers.
 *
 * COSTS REAL QUOTA. One Groq completion per sample, plus the mode's grounding
 * calls (Serper / CoinGecko / DefiLlama). Settle-free, spends nothing on-chain,
 * persists nothing. Default 12 samples; scale up deliberately.
 *
 * Run:
 *   pnpm sample:length                      # 2 runs x 6 modes
 *   pnpm sample:length --runs=5
 *   pnpm sample:length --runs=4 --modes=0,2
 */
import 'dotenv/config';
import { getMode } from '../lib/pipeline/modes';
import { completeThread } from '../lib/pipeline/generateDraft';
import { fitThread } from '../lib/threadShape';
import { TWEET_MAX_CHARS } from '../lib/threadParser';
import { MODE_LABEL, FIXTURES, numArg, modesArg } from './sampleFixtures';

interface Sample {
  mode: number;
  before: string[];
  after: string[];
  unfixable: number[];
}

const over = (tweets: string[]) => tweets.filter((t) => t.length > TWEET_MAX_CHARS);
const pct = (n: number, total: number) => (total === 0 ? '—' : `${((n / total) * 100).toFixed(1)}%`);

/** One side of the comparison, so BEFORE and AFTER are summarised identically
 *  and a difference between them can only come from the fit. */
function summarise(threads: string[][]) {
  const tweets = threads.flat();
  const bad = over(tweets);
  return {
    threads: threads.length,
    threadsOver: threads.filter((t) => over(t).length > 0).length,
    tweets: tweets.length,
    tweetsOver: bad.length,
    worst: bad.reduce((m, t) => Math.max(m, t.length - TWEET_MAX_CHARS), 0),
  };
}

/** Print the tally. Split out of main so an interrupted run can still report:
 *  a four-minute measurement that throws its numbers away on Ctrl-C is a tool
 *  people stop trusting, and the partial tally is usually already conclusive.
 *
 *  `planned` and `interrupted` are printed, not hidden — a number without the
 *  conditions it was taken under is worse than no number. */
function report(samples: Sample[], planned: number, interrupted: boolean): void {
  if (samples.length === 0) {
    console.log('\nNo samples generated.\n');
    return;
  }

  const before = summarise(samples.map((s) => s.before));
  const after = summarise(samples.map((s) => s.after));
  const unfixable = samples.reduce((n, s) => n + s.unfixable.length, 0);

  console.log(`\n${'—'.repeat(64)}`);
  console.log(
    interrupted
      ? `PARTIAL RESULT — INTERRUPTED after ${samples.length} of ${planned} planned threads\n`
      : `RESULT — ${samples.length} threads, paired before/after on the same completions\n`,
  );
  console.log(`                        BEFORE fit        AFTER fit`);
  console.log(
    `  threads over limit    ${String(before.threadsOver).padStart(3)} (${pct(before.threadsOver, before.threads).padStart(6)})` +
      `      ${String(after.threadsOver).padStart(3)} (${pct(after.threadsOver, after.threads).padStart(6)})`,
  );
  console.log(
    `  tweets over limit     ${String(before.tweetsOver).padStart(3)} of ${String(before.tweets).padEnd(4)}` +
      `      ${String(after.tweetsOver).padStart(3)} of ${after.tweets}`,
  );
  console.log(
    `  worst overage         ${String(before.worst).padStart(3)} chars` +
      `        ${after.worst} chars`,
  );
  console.log(`\n  repaired              ${before.tweetsOver - after.tweetsOver} tweets`);
  console.log(`  left over (no seam)   ${unfixable} tweets  — a human edit, by design`);
  console.log(`  tweet count           ${before.tweets} -> ${after.tweets}  (+${after.tweets - before.tweets} from splitting)`);

  const byMode = new Map<number, { b: number; a: number }>();
  for (const s of samples) {
    const m = byMode.get(s.mode) ?? { b: 0, a: 0 };
    m.b += over(s.before).length;
    m.a += over(s.after).length;
    byMode.set(s.mode, m);
  }
  console.log('\nBY MODE (over-limit tweets, before -> after)');
  for (const [id, m] of [...byMode.entries()].sort((x, y) => x[0] - y[0])) {
    console.log(`  ${(MODE_LABEL[id] ?? `mode ${id}`).padEnd(15)} ${m.b} -> ${m.a}`);
  }
  console.log('');
}

async function main() {
  const runs = numArg('runs', 2);
  const modes = modesArg();
  const planned = runs * modes.length;

  console.log(`\nSampling ${planned} threads — ${runs} run(s) x ${modes.length} mode(s)`);
  console.log(`One Groq completion each, plus grounding calls. Nothing is settled or persisted.\n`);

  const samples: Sample[] = [];

  // Ctrl-C stops collecting and reports, rather than discarding several minutes
  // of real generations. `once`, so a second Ctrl-C still kills outright.
  process.once('SIGINT', () => {
    console.log('\n\n^C — stopping here and reporting what was collected.');
    report(samples, planned, true);
    process.exit(130);
  });

  for (let run = 0; run < runs; run++) {
    for (const id of modes) {
      const mode = getMode(id);
      if (!mode) {
        console.error(`  unknown mode ${id}, skipped`);
        continue;
      }
      const fixtures = FIXTURES[id] ?? [];
      const input = fixtures[run % fixtures.length];
      if (!input) {
        console.error(`  no fixture for mode ${id}, skipped`);
        continue;
      }
      const label = `${MODE_LABEL[id] ?? id} run ${run + 1}`;
      try {
        const draft = await mode.buildMessages(input);
        if (!draft) {
          console.error(`  ${label}: no prompt for this input, skipped`);
          continue;
        }
        const before = await completeThread(draft);
        const { tweets: after, unfixable } = fitThread(before);
        samples.push({ mode: id, before, after, unfixable });
        const b = over(before).length;
        console.log(
          `  ${label.padEnd(22)} ${String(before.length).padStart(2)} tweets  ` +
            `${b} over -> ${over(after).length} over${unfixable.length ? `  (${unfixable.length} no seam)` : ''}`,
        );
      } catch (e) {
        console.error(`  ${label}: FAILED — ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  report(samples, planned, false);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
