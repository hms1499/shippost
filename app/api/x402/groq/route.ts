import { NextResponse } from 'next/server';
import { runGroqStep } from '@/lib/pipeline/groqStep';
import { isSupportedChain } from '@/lib/chains';
import { getContracts } from '@/lib/contracts';
import type { PipelineEvent } from '@/lib/pipeline/types';

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

  const contracts = getContracts(body.chainId);
  const events: PipelineEvent[] = [];

  try {
    const { tweets } = await runGroqStep(
      {
        chainId: body.chainId,
        threadId: BigInt(body.threadId),
        topic: body.topic,
        audience: body.audience ?? 'beginner',
        length: body.length ?? 5,
        agentWallet: contracts.AgentWallet,
      },
      (e) => events.push(e),
    );
    const settled = events.some((e) => e.type === 'step_settled');
    return NextResponse.json({
      tweets,
      output: tweets.join('\n\n'),
      events,
      settled,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: msg, events }, { status: 502 });
  }
}
