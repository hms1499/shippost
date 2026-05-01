import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { settleX402Call } from '@/lib/orchestrator';
import { isSupportedChain } from '@/lib/chains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface GroqRequest {
  threadId: string;
  topic: string;
  mode: 0 | 1;
  chainId: number;
  audience?: 'beginner' | 'intermediate' | 'advanced';
  length?: 5 | 8 | 12;
}

const SERVICE_ADDRESS = '0x000000000000000000000000000000000000dead' as const;
const MAX_TOPIC_LEN = 280;
const ALLOWED_LENGTHS = [5, 8, 12] as const;
const ALLOWED_AUDIENCES = ['beginner', 'intermediate', 'advanced'] as const;

function validate(input: unknown): { ok: true; body: GroqRequest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'invalid body' };
  const b = input as Record<string, unknown>;

  if (typeof b.threadId !== 'string' || !/^\d+$/.test(b.threadId)) {
    return { ok: false, error: 'threadId must be a numeric string' };
  }
  if (typeof b.topic !== 'string' || b.topic.length === 0) {
    return { ok: false, error: 'topic required' };
  }
  if (b.topic.length > MAX_TOPIC_LEN) {
    return { ok: false, error: `topic exceeds ${MAX_TOPIC_LEN} chars` };
  }
  if (b.mode !== 0 && b.mode !== 1) {
    return { ok: false, error: 'mode must be 0 or 1' };
  }
  if (typeof b.chainId !== 'number' || !isSupportedChain(b.chainId)) {
    return { ok: false, error: 'unsupported chainId' };
  }
  if (b.audience !== undefined && !ALLOWED_AUDIENCES.includes(b.audience as never)) {
    return { ok: false, error: 'invalid audience' };
  }
  if (b.length !== undefined && !ALLOWED_LENGTHS.includes(b.length as never)) {
    return { ok: false, error: 'invalid length' };
  }

  return {
    ok: true,
    body: {
      threadId: b.threadId,
      topic: b.topic.trim(),
      mode: b.mode,
      chainId: b.chainId,
      audience: b.audience as GroqRequest['audience'],
      length: b.length as GroqRequest['length'],
    },
  };
}

/**
 * Verify x402 payment intent.
 *
 * TODO(week-2): full EIP-712 verification — recover signer from `X-Payment`,
 * check domain (chainId, contract address), nonce store, expiry, and that
 * signer == AgentWallet owner. Until then, the route is locked behind a
 * `MOCK_SETTLE=true` gate so it cannot serve real traffic on mainnet.
 */
function verifyPayment(req: Request, mockSettle: boolean): { ok: true } | { ok: false; status: number; error: string } {
  const xPayment = req.headers.get('x-payment');

  if (mockSettle) {
    // Dev/test path: header presence not required, but log a warning so we
    // notice if this branch ever runs in production.
    if (process.env.NODE_ENV === 'production' && process.env.VERCEL_ENV === 'production') {
      return { ok: false, status: 503, error: 'x402 verification not implemented; refusing in production' };
    }
    return { ok: true };
  }

  if (!xPayment) {
    return { ok: false, status: 401, error: 'X-Payment header required' };
  }

  // Real verification not yet implemented — fail closed.
  return { ok: false, status: 501, error: 'x402 verification not implemented (Week 2)' };
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const parsed = validate(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const body = parsed.body;

  const mockSettle = process.env.MOCK_SETTLE !== 'false';

  const verify = verifyPayment(req, mockSettle);
  if (!verify.ok) {
    return NextResponse.json({ error: verify.error }, { status: verify.status });
  }

  const apiKey = process.env.GROQ_API_KEY;

  if (mockSettle || !apiKey) {
    if (!apiKey && !mockSettle) {
      return NextResponse.json({ error: 'GROQ_API_KEY missing' }, { status: 500 });
    }
    console.log(`[MOCK] x402 settle skipped for threadId=${body.threadId}`);
    const mock = [
      `1/ (mock) Thread about: ${body.topic}`,
      `2/ This is a placeholder response from the x402 proxy.`,
      `3/ Thread id: ${body.threadId}`,
      `4/ Replaced with real Groq generation when MOCK_SETTLE=false.`,
    ].join('\n\n');
    return NextResponse.json({ output: mock, settled: false });
  }

  const groq = new Groq({ apiKey });
  const audience = body.audience ?? 'beginner';
  const length = body.length ?? 5;

  const prompt =
    body.mode === 0
      ? `Write a punchy X (Twitter) thread explaining "${body.topic}" to a ${audience} audience. Produce exactly ${length} tweets. Format each tweet as "N/" followed by content, separated by blank lines. Keep tweets <280 chars.`
      : `Write a hot take thread about: ${body.topic}. ${length} tweets.`;

  let output: string;
  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a crypto/dev content writer. Keep tweets concise and high-signal.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
    });
    output = resp.choices[0]?.message?.content ?? '(empty response)';
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Groq failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  let settled = false;
  try {
    await settleX402Call({
      chainId: body.chainId,
      serviceAddress: SERVICE_ADDRESS,
      tokenSymbol: 'cUSD',
      amount: 1_000_000_000_000_000n,
      threadId: BigInt(body.threadId),
    });
    settled = true;
  } catch (e) {
    console.error('x402 settlement failed:', e);
  }

  return NextResponse.json({ output, settled });
}
