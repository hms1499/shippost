import { NextResponse } from 'next/server';
import { runSerperStep } from '@/lib/pipeline/serperStep';
import { isSupportedChain } from '@/lib/chains';
import { getContracts } from '@/lib/contracts';
import type { PipelineEvent } from '@/lib/pipeline/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SerperRequest {
  threadId: string;
  query: string;
  chainId: number;
}

const MAX_QUERY_LEN = 280;

function validate(input: unknown): { ok: true; body: SerperRequest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'invalid body' };
  const b = input as Record<string, unknown>;

  if (typeof b.threadId !== 'string' || !/^\d+$/.test(b.threadId)) {
    return { ok: false, error: 'threadId must be a numeric string' };
  }
  if (typeof b.query !== 'string' || b.query.trim().length === 0) {
    return { ok: false, error: 'query required' };
  }
  if (b.query.length > MAX_QUERY_LEN) {
    return { ok: false, error: `query exceeds ${MAX_QUERY_LEN} chars` };
  }
  if (typeof b.chainId !== 'number' || !isSupportedChain(b.chainId)) {
    return { ok: false, error: 'unsupported chainId' };
  }

  return {
    ok: true,
    body: { threadId: b.threadId, query: b.query.trim(), chainId: b.chainId },
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
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const body = parsed.body;

  const contracts = getContracts(body.chainId);
  const events: PipelineEvent[] = [];

  try {
    const result = await runSerperStep(
      {
        chainId: body.chainId,
        threadId: BigInt(body.threadId),
        topic: body.query,
        audience: 'beginner',
        agentWallet: contracts.AgentWallet,
        query: body.query,
      },
      (e) => events.push(e),
    );
    return NextResponse.json({ ...result, events });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: msg, events }, { status: 502 });
  }
}
