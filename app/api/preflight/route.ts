import { NextResponse } from 'next/server';
import {
  checkSpendReadiness,
  minGasOverrideForChain,
  type SpendReadiness,
} from '@/lib/agent/walletHealth';
import { isSupportedChain, DEFAULT_CHAIN_ID } from '@/lib/chainPolicy';
import { getTokens, type TokenSymbol } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The underlying state (paused, gas, cap) moves slowly and this route is public
// and hit on every preview, so serve a recent answer instead of an RPC round
// trip per tap. Keyed by chain as well as token: one chain's readiness is not
// an answer about another, and serving it would gate the wrong wallet.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: SpendReadiness }>();

// Asked before the user signs payForThread: can the agent actually settle an
// x402 call in this token right now? A "no" here means the wallet sheet never
// opens, so a run we cannot finish never takes the user's money.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const chainIdParam = Number(url.searchParams.get('chainId'));
  const chainId = isSupportedChain(chainIdParam) ? chainIdParam : DEFAULT_CHAIN_ID;

  // The valid token set is per-chain now — Base has no cUSD.
  const tokens = getTokens(chainId);
  if (!token || !(token in tokens)) {
    return NextResponse.json(
      { error: `token must be one of ${Object.keys(tokens).join(', ')}` },
      { status: 400 },
    );
  }
  const tokenSymbol = token as TokenSymbol;

  const cacheKey = `${chainId}:${tokenSymbol}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.value);
  }

  let readiness: SpendReadiness;
  try {
    // The override reaches the gate, not just the cron alert: without it the
    // blocking floor cannot be retuned on prod without a deploy.
    readiness = await checkSpendReadiness({
      chainId,
      tokenSymbol,
      minGasNative: minGasOverrideForChain(chainId),
    });
  } catch (e) {
    // Fail OPEN. This is a guard, not a gate of record: the backstop is the
    // invariant that every post-payment failure is clean and refundable, and a
    // preflight bug or RPC blip must never freeze all revenue. Deliberately not
    // cached — caching an "ok" we never actually verified would keep serving it
    // after the RPC recovers.
    console.error('[preflight] readiness check failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: true });
  }

  cache.set(cacheKey, { at: Date.now(), value: readiness });
  return NextResponse.json(readiness);
}
