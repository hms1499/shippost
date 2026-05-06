import { NextResponse } from 'next/server';
import { runFactCheckStep } from '@/lib/pipeline/factCheckStep';
import { isSupportedChain } from '@/lib/chains';
import { getContracts } from '@/lib/contracts';
import type { PipelineEvent } from '@/lib/pipeline/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface FCRequest {
  threadId: string;
  chainId: number;
  tweets: string[];
  searchSummary: string | null;
  marketData: string | null;
}

const MAX_TWEETS = 20;
const MAX_TWEET_LEN = 320;
const MAX_CONTEXT_LEN = 4000;

function validate(input: unknown): { ok: true; body: FCRequest } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'invalid body' };
  const b = input as Record<string, unknown>;

  if (typeof b.threadId !== 'string' || !/^\d+$/.test(b.threadId)) {
    return { ok: false, error: 'threadId must be a numeric string' };
  }
  if (typeof b.chainId !== 'number' || !isSupportedChain(b.chainId)) {
    return { ok: false, error: 'unsupported chainId' };
  }
  if (!Array.isArray(b.tweets) || b.tweets.length === 0 || b.tweets.length > MAX_TWEETS) {
    return { ok: false, error: `tweets must be an array of 1-${MAX_TWEETS}` };
  }
  for (const t of b.tweets) {
    if (typeof t !== 'string' || t.length === 0 || t.length > MAX_TWEET_LEN) {
      return { ok: false, error: 'each tweet must be a non-empty string' };
    }
  }
  if (b.searchSummary !== null && typeof b.searchSummary !== 'string') {
    return { ok: false, error: 'searchSummary must be string or null' };
  }
  if (b.marketData !== null && typeof b.marketData !== 'string') {
    return { ok: false, error: 'marketData must be string or null' };
  }
  if (typeof b.searchSummary === 'string' && b.searchSummary.length > MAX_CONTEXT_LEN) {
    return { ok: false, error: 'searchSummary too long' };
  }
  if (typeof b.marketData === 'string' && b.marketData.length > MAX_CONTEXT_LEN) {
    return { ok: false, error: 'marketData too long' };
  }

  return {
    ok: true,
    body: {
      threadId: b.threadId,
      chainId: b.chainId,
      tweets: b.tweets as string[],
      searchSummary: b.searchSummary as string | null,
      marketData: b.marketData as string | null,
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
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const body = parsed.body;

  const contracts = getContracts(body.chainId);
  const events: PipelineEvent[] = [];

  try {
    const result = await runFactCheckStep(
      {
        chainId: body.chainId,
        threadId: BigInt(body.threadId),
        topic: '',
        audience: 'beginner',
        agentWallet: contracts.AgentWallet,
      },
      {
        tweets: body.tweets,
        searchSummary: body.searchSummary,
        marketData: body.marketData,
      },
      (e) => events.push(e),
    );
    return NextResponse.json({ ...result, events });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ error: msg, events }, { status: 502 });
  }
}
