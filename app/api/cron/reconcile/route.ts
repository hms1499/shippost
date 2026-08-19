import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { reconcileStuckThreads } from '@/lib/agent/reconcile';
import {
  checkAgentWalletBalance,
  checkOrchestratorGas,
  checkReserveBalance,
  minGasOverrideForChain,
} from '@/lib/agent/walletHealth';
import { checkPreviewAlive } from '@/lib/agent/previewHealth';
import { claimAlertOnce } from '@/lib/rateLimit';
import { alertOps } from '@/lib/alert';
import { shareAppUrl } from '@/lib/shareText';
import { SUPPORTED_CHAIN_IDS } from '@/lib/chainPolicy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Throttle the recurring balance pages: at most once per 6h while low.
const LOW_BALANCE_TTL_SEC = 6 * 60 * 60;
const DEFAULT_AGENT_MIN_USD = 2;
const DEFAULT_RESERVE_MIN_USD = 0.5;
// Preview being down is a revenue-path outage, not a balance warning — page on
// every cron run it stays broken, so it cannot be slept through.
const PREVIEW_DOWN_TTL_SEC = 60;

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

    // Every chain we accept payments on, not one pinned chain: a chain nobody
    // watches is a chain that quietly runs out of gas or reserve. Each check is
    // isolated per chain, so one dead RPC never hides the others — and never
    // fails the primary reconcile job, which already succeeded above.
    for (const chainId of SUPPORTED_CHAIN_IDS) {
      // Heartbeat: agent wallet balance.
      try {
        const minUsd = Number(process.env.AGENT_WALLET_MIN_BALANCE_USD) || DEFAULT_AGENT_MIN_USD;
        const health = await checkAgentWalletBalance({ chainId, minUsd });
        if (
          health.low.length > 0 &&
          (await claimAlertOnce(`agent-wallet-low:${chainId}`, LOW_BALANCE_TTL_SEC))
        ) {
          await alertOps('AgentWallet balance low', {
            chainId,
            minUsd,
            low: health.low,
            balances: health.balances,
          });
        }
      } catch (e) {
        console.error(
          `[cron/reconcile] wallet health check failed on ${chainId}:`,
          e instanceof Error ? e.message : e,
        );
      }

      // Heartbeat: native gas on the EOA that signs executeX402Call. The ERC-20
      // check above is blind to it — a wallet full of stablecoins still settles
      // nothing once its signer is out of gas. Users now hit the preflight and
      // are blocked before paying, so page while there is still time to top up.
      try {
        // undefined means "use the computed, gas-priced requirement" — the
        // override is per chain because an ETH number is not a CELO number.
        const minNative = minGasOverrideForChain(chainId);
        const gas = await checkOrchestratorGas({ chainId, minNative });
        if (
          gas.low &&
          (await claimAlertOnce(`orchestrator-gas-low:${chainId}`, LOW_BALANCE_TTL_SEC))
        ) {
          await alertOps('Orchestrator EOA low on gas — x402 settles will fail', {
            chainId,
            minNative,
            address: gas.address,
            native: gas.native,
            requiredNative: gas.requiredNative,
          });
        }
      } catch (e) {
        console.error(
          `[cron/reconcile] orchestrator gas check failed on ${chainId}:`,
          e instanceof Error ? e.message : e,
        );
      }

      // Heartbeat: refund reserve held by the payment contract. A dry reserve
      // makes refunds fail, so page while there is still time to top it up.
      try {
        const minUsd = Number(process.env.RESERVE_MIN_BALANCE_USD) || DEFAULT_RESERVE_MIN_USD;
        const health = await checkReserveBalance({ chainId, minUsd });
        if (
          health.low.length > 0 &&
          (await claimAlertOnce(`reserve-low:${chainId}`, LOW_BALANCE_TTL_SEC))
        ) {
          await alertOps('Refund reserve low', {
            chainId,
            minUsd,
            low: health.low,
            balances: health.balances,
          });
        }
      } catch (e) {
        console.error(
          `[cron/reconcile] reserve health check failed on ${chainId}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    // Heartbeat: the free preview, probed over HTTP like a real visitor. It
    // fails CLOSED, and a fail-closed gate answers {available:false} with HTTP
    // 200 — so when it broke in prod it broke silently and stayed broken. This
    // is the check that would have caught it.
    try {
      const health = await checkPreviewAlive(shareAppUrl());
      if (
        !health.ok &&
        (await claimAlertOnce('preview-down', PREVIEW_DOWN_TTL_SEC))
      ) {
        await alertOps('free preview is DOWN — landing conversion path is dead', {
          reason: health.reason,
        });
      }
    } catch (e) {
      console.error(
        '[cron/reconcile] preview health check failed:',
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
