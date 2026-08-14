import { NextResponse } from 'next/server';
import { getAddress, type Address } from 'viem';
import { base } from 'wagmi/chains';
import { getContracts } from '@/lib/contracts';
import { getTokens } from '@/lib/tokens';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only the two methods a wallet needs to obtain sponsorship. Anything else —
// including eth_* — is refused: this is a paymaster proxy, not an RPC.
const ALLOWED_METHODS = new Set(['pm_getPaymasterStubData', 'pm_getPaymasterData']);

const APPROVE_SELECTOR = '0x095ea7b3';

function spenderFromApprove(callData: string): Address | null {
  if (!callData.startsWith(APPROVE_SELECTOR)) return null;
  const word = callData.slice(10, 74);
  if (word.length < 64) return null;
  try {
    return getAddress(`0x${word.slice(24)}`);
  } catch {
    return null;
  }
}

/**
 * Sponsorship proxy. The CDP paymaster URL is a secret and never reaches the
 * client, and every request is checked against an allowlist first.
 *
 * Without the allowlist this endpoint is a public wallet: any transaction sent
 * through it would have its gas paid by us. The checks are therefore
 * deny-by-default — an unrecognised target, selector or chain is refused, not
 * forwarded.
 *
 * The rate limit bounds the one drain the allowlist cannot: a caller can ask us
 * to sponsor payForThread calls that revert (no balance, no allowance), which
 * costs us gas and yields no payment. It fails open, per the project's
 * convention, because a limiter outage must not take payments offline.
 */
export async function POST(req: Request) {
  const rl = await checkRateLimit(getClientIp(req), 'paymaster');
  if (!rl.success) {
    return NextResponse.json(
      { error: 'rate limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.reset - Date.now()) / 1000)) },
      },
    );
  }

  const upstream = process.env.CDP_PAYMASTER_URL;
  if (!upstream) {
    return NextResponse.json({ error: 'sponsorship unavailable' }, { status: 503 });
  }

  let body: { method?: string; params?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (!body.method || !ALLOWED_METHODS.has(body.method)) {
    return NextResponse.json({ error: 'method not allowed' }, { status: 400 });
  }

  const userOp = body.params?.[0] as { to?: string; callData?: string } | undefined;
  const chainHex = body.params?.[2] as string | undefined;

  if (!chainHex || Number(chainHex) !== base.id) {
    return NextResponse.json({ error: 'chain not sponsored' }, { status: 403 });
  }
  if (!userOp?.to) {
    return NextResponse.json({ error: 'missing target' }, { status: 403 });
  }

  let payment: Address;
  try {
    payment = getAddress(getContracts(base.id).ShipPostPayment);
  } catch {
    return NextResponse.json({ error: 'sponsorship unavailable' }, { status: 503 });
  }

  let target: Address;
  try {
    target = getAddress(userOp.to);
  } catch {
    return NextResponse.json({ error: 'bad target' }, { status: 403 });
  }

  const allowed =
    target === payment ||
    // An approve is only sponsored when the spender is our payment contract:
    // sponsoring an arbitrary approve would let anyone fund token approvals to
    // an address of their choosing.
    (Object.values(getTokens(base.id)).some((t) => t && getAddress(t.address) === target) &&
      spenderFromApprove(userOp.callData ?? '') === payment);

  if (!allowed) {
    return NextResponse.json({ error: 'target not sponsored' }, { status: 403 });
  }

  const res = await fetch(upstream, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Pass the upstream body through verbatim, but never its URL or headers.
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  });
}
