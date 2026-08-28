/**
 * Process ONE queued refund request by id.
 *
 * The safety sequence itself lives in lib/refundWorker.ts so it is covered by
 * `pnpm test:lib` and shared with the queue drainer — two copies of money-moving
 * code is how two refund paths drift until one double-sends.
 *
 * Usage:
 *   pnpm refund:process <requestId> [--amount=0.02]
 *
 * `--amount` is REQUIRED for a partial refund and rejected for the others,
 * because how much a degraded thread was worth is a human judgement.
 *
 * Requires REFUND_ADMIN_KEY to be set (a presence check that protects against
 * accidental runs in the wrong shell, not an authorization layer).
 */
import 'dotenv/config';
import { getSupabaseServer } from '../lib/supabase';
import { processRefundRequest } from '../lib/refundWorker';

function parseArgs() {
  const args = process.argv.slice(2);
  const requestIdStr = args.find((a) => !a.startsWith('--'));
  const amountOverride = args.find((a) => a.startsWith('--amount='))?.split('=')[1];
  if (!requestIdStr) {
    console.log('usage: pnpm refund:process <requestId> [--amount=0.02]');
    process.exit(1);
  }
  const requestId = Number(requestIdStr);
  if (!Number.isFinite(requestId)) {
    console.error('requestId must be a number');
    process.exit(1);
  }
  return { requestId, amountOverride };
}

async function main() {
  if (!process.env.REFUND_ADMIN_KEY) {
    console.error('REFUND_ADMIN_KEY missing — refuse to process refund');
    process.exit(1);
  }
  const { requestId, amountOverride } = parseArgs();

  const out = await processRefundRequest({
    supabase: getSupabaseServer(),
    requestId,
    amountOverride,
    log: (l) => console.log(l),
  });

  switch (out.status) {
    case 'sent':
      console.log(`✓ refunded ${out.amountHuman} — tx: ${out.txHash}`);
      return;
    case 'already-refunded':
      console.error(`thread already refunded (tx ${out.txHash}) — queue row reconciled, nothing sent`);
      process.exit(1);
      return;
    case 'not-pending':
      console.error(`request #${requestId} is "${out.actual}", not pending — skip`);
      process.exit(1);
      return;
    case 'lost-lock':
      console.error(`request #${requestId} was not pending at lock time — another worker holds it.`);
      process.exit(1);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  console.error(
    '\n⚠  If the failure happened during send, the row is left in \'processing\' and the\n' +
      '   transfer MAY have been broadcast. Check the recipient on the explorer before\n' +
      '   any retry; to retry, confirm nothing landed, then reset status to \'pending\'.',
  );
  process.exit(1);
});
