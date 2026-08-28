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
import { getMode, type PreviewInput } from '../lib/pipeline/modes';
import { completeThread } from '../lib/pipeline/generateDraft';
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

/** Inputs per mode, cycled by run index so repeated runs vary the topic rather
 *  than re-rolling the same prompt. Educational leans on dense/advanced topics
 *  because that is where over-long tweets were seen to concentrate. */
const FIXTURES: Record<number, PreviewInput[]> = {
  0: [
    { mode: 0, topic: 'EIP-4844 blob fee market', audience: 'advanced' },
    { mode: 0, topic: 'ERC-4337 bundler economics', audience: 'advanced' },
    { mode: 0, topic: 'how an optimistic rollup fraud proof works', audience: 'intermediate' },
    { mode: 0, topic: 'what a stablecoin depeg actually is', audience: 'beginner' },
  ],
  1: [
    { mode: 1, eventDescription: 'Base sequencer revenue fell sharply after Dencun', angle: 'skeptical' },
    { mode: 1, eventDescription: 'A major L2 announced it is decentralising its sequencer', angle: 'bullish' },
    { mode: 1, eventDescription: 'Another bridge exploit drained nine figures', angle: 'bearish' },
  ],
  2: [
    { mode: 2, topic: 'CELO', angle: 'skeptical' },
    { mode: 2, topic: 'ARB', angle: 'bearish' },
    { mode: 2, topic: 'OP', angle: 'bullish' },
  ],
  3: [{ mode: 3 }],
  4: [
    { mode: 4, topic: 'base|arbitrum' },
    { mode: 4, topic: 'solana|ethereum' },
    { mode: 4, topic: 'celo|polygon' },
  ],
  5: [
    { mode: 5, eventDescription: 'Circle expanded native USDC to another L2' },
    { mode: 5, eventDescription: 'The SEC closed an enforcement action against a DeFi protocol' },
  ],
};

interface Sample {
  mode: number;
  before: string[];
  after: string[];
  unfixable: number[];
}

function numArg(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const n = Number(arg.slice(name.length + 3));
  if (!Number.isFinite(n) || n < 1) throw new Error(`bad --${name}: ${arg}`);
  return n;
}

function modesArg(): number[] {
  const arg = process.argv.find((a) => a.startsWith('--modes='));
  if (!arg) return [0, 1, 2, 3, 4, 5];
  return arg
    .slice('--modes='.length)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
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

async function main() {
  const runs = numArg('runs', 2);
  const modes = modesArg();
  const planned = runs * modes.length;

  console.log(`\nSampling ${planned} threads — ${runs} run(s) x ${modes.length} mode(s)`);
  console.log(`One Groq completion each, plus grounding calls. Nothing is settled or persisted.\n`);

  const samples: Sample[] = [];
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

  if (samples.length === 0) {
    console.log('\nNo samples generated.\n');
    return;
  }

  const before = summarise(samples.map((s) => s.before));
  const after = summarise(samples.map((s) => s.after));
  const unfixable = samples.reduce((n, s) => n + s.unfixable.length, 0);

  console.log(`\n${'—'.repeat(64)}`);
  console.log(`RESULT — ${samples.length} threads, paired before/after on the same completions\n`);
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

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
