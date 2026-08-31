/**
 * Thread READ sampler — prints the threads themselves, not statistics about them.
 *
 * The companion to thread-length-sample.ts. That one answers "does the model
 * break 280 chars"; this one answers "is what it wrote any good", which no
 * counter can tell you. It exists because judging a prompt change by re-reading
 * the prompt is how you talk yourself into a change that made things worse.
 *
 * With --prompt it also dumps the user message, grounding included. That pairing
 * is the point: a thread on its own cannot be checked, but a thread NEXT TO the
 * references it was given can — every address, signature, gas figure, price and
 * date in the output should be traceable to something in that block, or be
 * canonical. That is exactly the check that caught mode 0 inventing
 * "commitBlob(bytes) at 0x4200...0010" on 2026-08-31.
 *
 * Prompts come from each mode's own buildMessages(), grounding included, so a
 * prompt change is reflected here automatically. Nothing is rebuilt by hand:
 * a harness running a stale copy of a prompt reports confidently wrong output.
 *
 * COSTS REAL QUOTA. One Groq completion per sample, plus the mode's grounding
 * calls (Serper / CoinGecko / DefiLlama). Settle-free, spends nothing on-chain,
 * persists nothing. Default 1 run x 6 modes; scale up deliberately.
 *
 * Run:
 *   pnpm sample:read                          # 1 run x 6 modes
 *   pnpm sample:read --modes=0 --runs=4       # four Educational topics
 *   pnpm sample:read --modes=0 --prompt       # with the grounding it was given
 */
import 'dotenv/config';
import { getMode } from '../lib/pipeline/modes';
import { completeThread } from '../lib/pipeline/generateDraft';
import { MODE_LABEL, FIXTURES, numArg, modesArg } from './sampleFixtures';

const RULE = '='.repeat(72);

function describeInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .filter(([k]) => k !== 'mode')
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join('  ');
}

async function main() {
  const runs = numArg('runs', 1);
  const modes = modesArg();
  const showPrompt = process.argv.includes('--prompt');
  const planned = runs * modes.length;

  console.log(`\nReading ${planned} threads — ${runs} run(s) x ${modes.length} mode(s)`);
  console.log('One Groq completion each, plus grounding calls. Nothing is settled or persisted.');
  if (!showPrompt) console.log('Pass --prompt to print the grounding each thread was given.');

  let ok = 0;
  let failed = 0;

  for (let run = 0; run < runs; run++) {
    for (const id of modes) {
      const mode = getMode(id);
      if (!mode) {
        console.error(`\n  unknown mode ${id}, skipped`);
        continue;
      }
      const fixtures = FIXTURES[id] ?? [];
      const input = fixtures[run % fixtures.length];
      if (!input) {
        console.error(`\n  no fixture for mode ${id}, skipped`);
        continue;
      }

      const label = `${MODE_LABEL[id] ?? `mode ${id}`} — run ${run + 1}`;
      console.log(`\n${RULE}\n${label}\n${describeInput(input as unknown as Record<string, unknown>)}\n${RULE}`);

      try {
        const draft = await mode.buildMessages(input);
        if (!draft) {
          console.error('  no prompt built for this input, skipped');
          continue;
        }
        if (showPrompt) {
          const user = draft.messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n\n');
          console.log(`\n--- PROMPT (user message) ---\n${user}\n--- END PROMPT ---`);
        }
        const tweets = await completeThread(draft);
        for (const t of tweets) console.log(`\n${t}`);
        ok++;
      } catch (e) {
        console.error(`  FAILED — ${e instanceof Error ? e.message : e}`);
        failed++;
      }
    }
  }

  // Printed, not hidden: a read session where a third of the samples failed is
  // a different piece of evidence from one where none did, and you cannot see
  // that by scrolling back through the threads that did print.
  console.log(`\n${RULE}\n${ok} thread(s) printed, ${failed} failed, of ${planned} planned.\n`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
