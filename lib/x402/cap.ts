import { Redis } from '@upstash/redis';

function redis() {
  return Redis.fromEnv();
}

function secondsToNextUtcMidnight(now = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
}

// Layer 3 kill-switch: env flag OR a Redis key, so it can be flipped without a
// redeploy. NOTE: this only stops OUR code path — a stolen agent key bypasses
// it (that is what the small hot float guards against, see spec D3).
export async function isPaused(): Promise<boolean> {
  if (process.env.X402_PAUSED === 'true') return true;
  return (await redis().get<string>('x402:paused')) === '1';
}

// Layer 2: reserve `amountRaw` against a per-UTC-day counter. Throws if it would
// exceed the cap. Amounts are small USDC raw units (0.001 USDC = 1000), well
// within JS Number range, so incrby/decrby take Number. Over-counting on later
// failure is conservative (stops sooner) — acceptable for a spend cap.
export async function reserveDailySpend(params: {
  caip2: string;
  token: string;
  amountRaw: bigint;
  capRaw: bigint;
}): Promise<void> {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  // Namespaced by chain: the same token symbol has a different address per
  // chain, and two settlement chains must not share one budget. Changing this
  // key shape resets the running counter once, on the day it ships — bounded at
  // one extra cap's worth of spend, which the cap exists to bound anyway.
  const key = `x402:spend:${day}:${params.caip2}:${params.token}`;
  const r = redis();
  const total = await r.incrby(key, Number(params.amountRaw));
  await r.expire(key, secondsToNextUtcMidnight());
  if (BigInt(total) > params.capRaw) {
    await r.decrby(key, Number(params.amountRaw));
    throw new Error('x402 daily spend cap exceeded');
  }
}
