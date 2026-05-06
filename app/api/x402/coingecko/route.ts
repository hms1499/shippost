import { NextResponse } from 'next/server';
import { runCoinGeckoStep } from '@/lib/pipeline/coingeckoStep';
import { isSupportedChain } from '@/lib/chains';
import { getContracts } from '@/lib/contracts';
import type { PipelineEvent } from '@/lib/pipeline/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CGRequest {
  threadId: string;
  topic: string;
  chainId: number;
}

const MAX_TOPIC_LEN = 280;

function validate(input: unknown): { ok: true; body: CGRequest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'invalid body' };
  const b = input as Record<string, unknown>;

  if (typeof b.threadId !== 'string' || !/^\d+$/.test(b.threadId)) {
    return { ok: false, error: 'threadId must be a numeric string' };
  }
  if (typeof b.topic !== 'string' || b.topic.trim().length === 0) {
    return { ok: false, error: 'topic required' };
  }
  if (b.topic.length > MAX_TOPIC_LEN) {
    return { ok: false, error: `topic exceeds ${MAX_TOPIC_LEN} chars` };
  }
  if (typeof b.chainId !== 'number' || !isSupportedChain(b.chainId)) {
    return { ok: false, error: 'unsupported chainId' };
  }

  return { ok: true, body: { threadId: b.threadId, topic: b.topic.trim(), chainId: b.chainId } };
}

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const parsed = validate(raw);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const body = parsed.body;

  const contracts = getContracts(body.chainId);
  const events: PipelineEvent[] = [];

  try {
    const result = await runCoinGeckoStep(
      {
        chainId: body.chainId,
        threadId: BigInt(body.threadId),
        topic: body.topic,
        audience: 'beginner',
        agentWallet: contracts.AgentWallet,
      },
      (e) => events.push(e),
    );
    return NextResponse.json({ ...result, events });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: msg, events }, { status: 502 });
  }
}
