import { NextResponse } from 'next/server';
import { checkSpendReadiness, type SpendReadiness } from '@/lib/agent/walletHealth';
import { TARGET_CHAIN_ID } from '@/lib/targetChain';
import type { TokenSymbol } from '@/lib/tokens';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKENS: readonly TokenSymbol[] = ['cUSD', 'USDT', 'USDC'];

// The underlying state (paused, gas, cap) moves slowly and this route is public
// and hit on every preview, so serve a recent answer instead of an RPC round
// trip per tap.
const CACHE_TTL_MS = 30_000;
const cache = new Map<TokenSymbol, { at: number; value: SpendReadiness }>();

// Asked before the user signs payForThread: can the agent actually settle an
// x402 call in this token right now? A "no" here means the wallet sheet never
// opens, so a run we cannot finish never takes the user's $0.05.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  if (!token || !TOKENS.includes(token as TokenSymbol)) {
    return NextResponse.json({ error: 'token must be cUSD, USDT, or USDC' }, { status: 400 });
  }
  const tokenSymbol = token as TokenSymbol;

  const hit = cache.get(tokenSymbol);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return NextResponse.json(hit.value);
  }

  let readiness: SpendReadiness;
  try {
    readiness = await checkSpendReadiness({ chainId: TARGET_CHAIN_ID, tokenSymbol });
  } catch (e) {
    // Fail OPEN. This is a guard, not a gate of record: the backstop is the
    // invariant that every post-payment failure is clean and refundable, and a
    // preflight bug or RPC blip must never freeze all revenue. Deliberately not
    // cached — caching an "ok" we never actually verified would keep serving it
    // after the RPC recovers.
    console.error('[preflight] readiness check failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: true });
  }

  cache.set(tokenSymbol, { at: Date.now(), value: readiness });
  return NextResponse.json(readiness);
}
