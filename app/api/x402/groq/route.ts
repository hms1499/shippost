import { NextRequest, NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { withX402 } from '@x402/next';
import { parseThread, boundThread } from '@/lib/threadParser';
import { getResourceServer } from '@/lib/x402/server';
import { getX402ChainConfig, priceForChain, GROQ_MODEL, groqCompletionExtras } from '@/lib/x402/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProxyBody {
  messages?: { role: string; content: string }[];
  temperature?: number;
  maxTokens?: number;
}

const handler = async (req: NextRequest): Promise<NextResponse<unknown>> => {
  let body: ProxyBody;
  try {
    body = (await req.json()) as ProxyBody;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'server misconfigured' }, { status: 500 });

  let raw: string;
  try {
    const groq = new Groq({ apiKey });
    const resp = await groq.chat.completions.create({
      model: GROQ_MODEL,
      messages: body.messages as { role: 'system' | 'user'; content: string }[],
      temperature: body.temperature ?? 0.7,
      max_tokens: body.maxTokens ?? 1200,
      ...groqCompletionExtras(),
    });
    raw = resp.choices[0]?.message?.content ?? '';
  } catch {
    // Return 502: withX402 settles only on status < 400, so a Groq failure
    // means no settle (no charge).
    return NextResponse.json({ error: 'groq failed' }, { status: 502 });
  }

  let tweets: string[];
  try {
    tweets = boundThread(parseThread(raw)); // empty/junk throws -> no settle
  } catch {
    return NextResponse.json({ error: 'invalid thread' }, { status: 422 });
  }

  // 200 -> withX402 settles AFTER this returns. Content + settlement together.
  return NextResponse.json({ tweets }, { status: 200 });
};

const SETTLE_CHAIN_ID = Number(process.env.X402_CHAIN_ID || '84532');
const cfg = getX402ChainConfig(SETTLE_CHAIN_ID);

// payTo for the x402 charge. Mirrors GROQ_SINK in groqStep.ts: an unset/invalid
// value falls back to the burn address rather than throwing, so `next build`
// and legacy-mode deployments (which never set X402_PAY_TO) still load this
// route (mirrors the GROQ_SINK fallback in groqCost.ts). A real x402 deployment
// MUST set X402_PAY_TO to a treasury it controls.
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
      // Explicit asset + atomic amount. A money string would send @x402/evm to
      // its own DEFAULT_STABLECOINS table, which has no Celo entry.
      price: priceForChain(SETTLE_CHAIN_ID),
      network: cfg.caip2,
      payTo: PAY_TO as `0x${string}`,
      maxTimeoutSeconds: 120,
    },
    description: 'CoinOp AI thread generation (Groq)',
    mimeType: 'application/json',
  },
  getResourceServer(),
);
