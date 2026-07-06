import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { reconcileStuckThreads } from '@/lib/agent/reconcile';
import { checkAgentWalletBalance, checkReserveBalance } from '@/lib/agent/walletHealth';
import { claimAlertOnce } from '@/lib/rateLimit';
import { alertOps } from '@/lib/alert';
import { TARGET_CHAIN_ID } from '@/lib/targetChain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Throttle the recurring balance pages: at most once per 6h while low.
const LOW_BALANCE_TTL_SEC = 6 * 60 * 60;
const DEFAULT_AGENT_MIN_USD = 2;
const DEFAULT_RESERVE_MIN_USD = 0.5;

// Scheduled sweeper (see vercel.json crons). Recovers threads stuck in
// status='pending' — paid, never delivered, never refunded — by queuing a
// slow-cancel refund and flipping them to 'failed'. Never sends money; a human
// still drains the queue. Vercel Cron authenticates with the Authorization:
// Bearer $CRON_SECRET header it injects when CRON_SECRET is set.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await reconcileStuckThreads(getSupabaseServer());

    if (result.swept > 0 || result.errors.length > 0) {
      await alertOps(
        `reconcile: swept ${result.swept} stuck thread(s), enqueued ${result.enqueued} refund(s)` +
          (result.errors.length ? `, ${result.errors.length} error(s)` : ''),
        result,
      );
    }

    // Heartbeat: agent wallet balance. Isolated so an RPC hiccup here never
    // fails the primary reconcile job (which already succeeded above).
    try {
      const minUsd = Number(process.env.AGENT_WALLET_MIN_BALANCE_USD) || DEFAULT_AGENT_MIN_USD;
      const health = await checkAgentWalletBalance({ chainId: TARGET_CHAIN_ID, minUsd });
      if (
        health.low.length > 0 &&
        (await claimAlertOnce(`agent-wallet-low:${TARGET_CHAIN_ID}`, LOW_BALANCE_TTL_SEC))
      ) {
        await alertOps('AgentWallet balance low', {
          chainId: TARGET_CHAIN_ID,
          minUsd,
          low: health.low,
          balances: health.balances,
        });
      }
    } catch (e) {
      console.error(
        '[cron/reconcile] wallet health check failed:',
        e instanceof Error ? e.message : e,
      );
    }

    // Heartbeat: refund reserve held by the payment contract. A dry reserve
    // makes refunds fail, so page while there is still time to top it up.
    try {
      const minUsd = Number(process.env.RESERVE_MIN_BALANCE_USD) || DEFAULT_RESERVE_MIN_USD;
      const health = await checkReserveBalance({ chainId: TARGET_CHAIN_ID, minUsd });
      if (
        health.low.length > 0 &&
        (await claimAlertOnce(`reserve-low:${TARGET_CHAIN_ID}`, LOW_BALANCE_TTL_SEC))
      ) {
        await alertOps('Refund reserve low', {
          chainId: TARGET_CHAIN_ID,
          minUsd,
          low: health.low,
          balances: health.balances,
        });
      }
    } catch (e) {
      console.error(
        '[cron/reconcile] reserve health check failed:',
        e instanceof Error ? e.message : e,
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await alertOps('reconcile cron crashed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
