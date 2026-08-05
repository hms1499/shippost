import { NextRequest, NextResponse } from 'next/server';
import { withX402 } from '@x402/next';
import { getResourceServer } from '@/lib/x402/server';
import { getX402ChainConfig, priceForChain } from '@/lib/x402/config';
import { getRows, selectCoins, DEFAULT_LIMIT } from '@/lib/x402/marketSnapshot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body {
  coins?: unknown;
  limit?: unknown;
}

// Sibling of /api/x402/groq: same rail, same price, no LLM. It sells the
// CoinGecko snapshot the pipeline already reads, so serving a buyer costs
// nothing beyond the shared cache refresh.
const handler = async (req: NextRequest): Promise<NextResponse<unknown>> => {
  let body: Body = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const coins = Array.isArray(body.coins) ? body.coins.filter((c): c is string => typeof c === 'string') : undefined;
  const limit = typeof body.limit === 'number' ? body.limit : DEFAULT_LIMIT;

  let rows;
  try {
    rows = await getRows();
  } catch {
    // 502 -> withX402 does not settle. A failed upstream must never charge.
    return NextResponse.json({ error: 'market data unavailable' }, { status: 502 });
  }

  const selected = selectCoins(rows, coins, limit);
  if (selected.length === 0) {
    // No match is a bad request, not a sale.
    return NextResponse.json({ error: 'no matching coins' }, { status: 422 });
  }

  return NextResponse.json(
    { asOf: new Date().toISOString(), source: 'coingecko', count: selected.length, coins: selected },
    { status: 200 },
  );
};

const SETTLE_CHAIN_ID = Number(process.env.X402_CHAIN_ID || '84532');
const cfg = getX402ChainConfig(SETTLE_CHAIN_ID);

const RAW_PAY_TO = process.env.X402_PAY_TO;
const PAY_TO: `0x${string}` =
  RAW_PAY_TO && /^0x[a-fA-F0-9]{40}$/.test(RAW_PAY_TO)
    ? (RAW_PAY_TO as `0x${string}`)
    : '0x000000000000000000000000000000000000dEaD';

export const POST = withX402(
  handler,
  {
    accepts: {
      scheme: 'exact',
      price: priceForChain(SETTLE_CHAIN_ID),
      network: cfg.caip2,
      payTo: PAY_TO,
      maxTimeoutSeconds: 120,
    },
    description: 'CoinOp market snapshot (CoinGecko, 60s cache)',
    mimeType: 'application/json',
  },
  getResourceServer(),
);
