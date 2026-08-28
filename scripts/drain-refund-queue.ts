/**
 * Drain the queued refunds that can be settled without a human decision.
 *
 * The queue was only ever drainable one id at a time (`pnpm refund:process`),
 * which is fine at three rows and is the operational cliff at three hundred.
 * This walks the pending rows and runs the SAME sequence per row
 * (lib/refundWorker.ts) — it automates the loop, nothing else.
 *
 * WHAT IT WILL NOT DO
 *
 *  - `partial` requests. Their amount is a judgement about what a degraded
 *    thread was worth, and ErrorSurface.tsx documents that as the user's call.
 *    A drainer that invented an amount would be over-refunding by policy.
 *  - Keep going after a failed send. At that moment the on-chain state of ONE
 *    refund is unknown; carrying on would turn that into several. It stops and
 *    leaves the rest pending.
 *  - Run on a server. refundThread signs with DEPLOYER_PRIVATE_KEY, which owns
 *    the payment contract (pause, withdraw reserve, withdraw agent wallet). That
 *    key is deliberately absent from the Vercel environment and this script is
 *    not a reason to put it there. Run it locally, like every other ops script.
 *
 * DRY RUN BY DEFAULT. Pass --send to actually move money.
 *
 * Usage:
 *   pnpm refund:drain                 # show what would be sent
 *   pnpm refund:drain --send
 *   pnpm refund:drain --send --limit=3
 */
import 'dotenv/config';
import { getSupabaseServer } from '../lib/supabase';
import { processRefundRequest } from '../lib/refundWorker';

// Kinds whose amount is a pure function of the on-chain payment: 100% and 50%.
const AUTOMATABLE = ['full', 'slow-cancel'] as const;

function numArg(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const n = Number(arg.slice(name.length + 3));
  if (!Number.isFinite(n) || n < 1) throw new Error(`bad --${name}: ${arg}`);
  return n;
}

async function main() {
  const send = process.argv.includes('--send');
  const limit = numArg('limit', 10);

  if (send && !process.env.REFUND_ADMIN_KEY) {
    console.error('REFUND_ADMIN_KEY missing — refuse to send refunds');
    process.exit(1);
  }

  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('refund_requests')
    .select('id, chain_id, onchain_thread_id, wallet_address, kind, created_at')
    .eq('status', 'pending')
    .in('kind', AUTOMATABLE as unknown as string[])
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(`supabase: ${error.message}`);

  const rows = data ?? [];
  const { count: partials } = await supabase
    .from('refund_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .eq('kind', 'partial');

  console.log(`\n${send ? 'DRAINING' : 'DRY RUN'} — ${rows.length} automatable request(s), limit ${limit}\n`);

  if (rows.length === 0) {
    console.log('Nothing to do.');
  }

  let sent = 0;
  let skipped = 0;
  for (const r of rows) {
    const head = `#${r.id} ${r.kind} chain ${r.chain_id} thread ${r.onchain_thread_id} → ${r.wallet_address}`;
    if (!send) {
      console.log(`  would process  ${head}`);
      continue;
    }
    try {
      const out = await processRefundRequest({
        supabase,
        requestId: r.id,
        log: (l) => console.log(l),
      });
      if (out.status === 'sent') {
        sent += 1;
        console.log(`  ✓ #${r.id} sent ${out.amountHuman} — ${out.txHash}`);
      } else {
        skipped += 1;
        console.log(`  – #${r.id} skipped (${out.status})`);
      }
    } catch (e) {
      // One unknown on-chain state is recoverable by hand. Several are not.
      console.error(`\n✗ #${r.id} FAILED — ${e instanceof Error ? e.message : e}`);
      console.error(
        '  Stopping. That row is left in \'processing\' and its transfer MAY have been\n' +
          '  broadcast — check the recipient on the explorer before any retry.\n' +
          `  ${rows.length - sent - skipped - 1} request(s) left untouched.`,
      );
      process.exit(1);
    }
  }

  if (send) console.log(`\nSent ${sent}, skipped ${skipped}.`);
  if (partials && partials > 0) {
    console.log(
      `\n${partials} pending 'partial' request(s) NOT touched — they need an explicit amount:` +
        `\n  pnpm refund:process <id> --amount=<human>`,
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
