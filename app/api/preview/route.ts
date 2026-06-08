import { NextResponse } from 'next/server';
import { checkPreviewAllowed, getClientIp } from '@/lib/rateLimit';
import { runPreview, type PreviewInput } from '@/lib/pipeline/runPreview';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AUDIENCES = ['beginner', 'intermediate', 'advanced'] as const;
const ANGLES = ['bullish', 'bearish', 'skeptical'] as const;
const PREVIEW_DEADLINE_MS = 30_000;

interface Body {
  mode?: number;
  walletAddress?: string;
  topic?: string;
  audience?: string;
  eventDescription?: string;
  angle?: string;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (typeof body.walletAddress !== 'string' || body.walletAddress.length === 0) {
    return NextResponse.json({ error: 'walletAddress required' }, { status: 400 });
  }
  if (body.mode !== 0 && body.mode !== 1 && body.mode !== 2) {
    return NextResponse.json({ error: 'mode must be 0, 1, or 2' }, { status: 400 });
  }

  let input: PreviewInput;
  if (body.mode === 0) {
    if (typeof body.topic !== 'string' || !body.topic.trim()) {
      return NextResponse.json({ error: 'topic required' }, { status: 400 });
    }
    const audience = AUDIENCES.includes(body.audience as never)
      ? (body.audience as PreviewInput['audience'])
      : 'beginner';
    input = { mode: 0, topic: body.topic, audience };
  } else if (body.mode === 2) {
    // Token Analysis — the ticker rides in on `topic`.
    if (typeof body.topic !== 'string' || !body.topic.trim()) {
      return NextResponse.json({ error: 'token ticker required' }, { status: 400 });
    }
    const angle = ANGLES.includes(body.angle as never)
      ? (body.angle as PreviewInput['angle'])
      : 'skeptical';
    input = { mode: 2, topic: body.topic, angle };
  } else {
    if (typeof body.eventDescription !== 'string' || !body.eventDescription.trim()) {
      return NextResponse.json({ error: 'eventDescription required' }, { status: 400 });
    }
    const angle = ANGLES.includes(body.angle as never)
      ? (body.angle as PreviewInput['angle'])
      : 'bullish';
    input = { mode: 1, eventDescription: body.eventDescription, angle };
  }

  // Fail-closed gate: deny → fall back to pay-first on the client. Per-IP is
  // bounded too, so a forged walletAddress can't rotate past the limit.
  const gate = await checkPreviewAllowed(body.walletAddress, getClientIp(request));
  if (!gate.allowed) {
    return NextResponse.json({ available: false }, { status: 200 });
  }

  try {
    const { tweets } = await Promise.race([
      runPreview(input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('preview timed out')), PREVIEW_DEADLINE_MS),
      ),
    ]);
    if (!tweets.length) {
      return NextResponse.json({ error: 'empty preview' }, { status: 502 });
    }
    return NextResponse.json({ firstTweet: tweets[0], totalTweets: tweets.length }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'preview failed' },
      { status: 502 },
    );
  }
}
