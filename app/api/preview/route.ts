import { NextResponse } from 'next/server';
import { checkPreviewAllowed, checkPreviewGuestAllowed, getClientIp } from '@/lib/rateLimit';
import { runPreview, type PreviewInput } from '@/lib/pipeline/runPreview';
import type { EventContext } from '@/lib/eventContext';

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
  eventContext?: EventContext | null;
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (
    body.mode !== 0 &&
    body.mode !== 1 &&
    body.mode !== 2 &&
    body.mode !== 3 &&
    body.mode !== 4 &&
    body.mode !== 5
  ) {
    return NextResponse.json({ error: 'mode must be 0, 1, 2, 3, 4, or 5' }, { status: 400 });
  }

  // walletAddress is optional: absent means a pre-connect guest tasting from the
  // landing. Guests are restricted to Educational (mode 0) — the only one-field
  // mode — and gated on IP + global budget only. Connected callers keep the full
  // mode range and the per-wallet gate.
  const walletAddress = typeof body.walletAddress === 'string' ? body.walletAddress : '';
  const isGuest = walletAddress.length === 0;
  if (isGuest && body.mode !== 0) {
    return NextResponse.json({ error: 'walletAddress required for this mode' }, { status: 400 });
  }

  let input: PreviewInput;
  if (body.mode === 3) {
    // Daily Recap is deliberately input-free — the grounding is the input.
    input = { mode: 3 };
  } else if (body.mode === 0) {
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
  } else if (body.mode === 4) {
    // Chain Comparison — the two chain keys ride in on `topic` as "a|b".
    if (typeof body.topic !== 'string' || !body.topic.trim()) {
      return NextResponse.json({ error: 'topic required' }, { status: 400 });
    }
    input = { mode: 4, topic: body.topic };
  } else if (body.mode === 5) {
    // News Breakdown — one news item, no angle. Same input contract as mode 1
    // minus the angle.
    if (typeof body.eventDescription !== 'string' || !body.eventDescription.trim()) {
      return NextResponse.json({ error: 'eventDescription required' }, { status: 400 });
    }
    input = { mode: 5, eventDescription: body.eventDescription, eventContext: body.eventContext ?? null };
  } else {
    if (typeof body.eventDescription !== 'string' || !body.eventDescription.trim()) {
      return NextResponse.json({ error: 'eventDescription required' }, { status: 400 });
    }
    const angle = ANGLES.includes(body.angle as never)
      ? (body.angle as PreviewInput['angle'])
      : 'bullish';
    input = { mode: 1, eventDescription: body.eventDescription, angle, eventContext: body.eventContext ?? null };
  }

  // Fail-closed gate: deny → fall back to pay-first on the client. Per-IP is
  // bounded too, so a forged walletAddress can't rotate past the limit.
  const ip = getClientIp(request);
  const gate = isGuest
    ? await checkPreviewGuestAllowed(ip)
    : await checkPreviewAllowed(walletAddress, ip);
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
