import { NextResponse } from 'next/server';
import ogs from 'open-graph-scraper';
import { parseUrl } from '@/lib/urlParser';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OgImage {
  url?: string;
}

export async function POST(req: Request) {
  const rl = await checkRateLimit(getClientIp(req), 'url-preview');
  if (!rl.success) {
    return NextResponse.json(
      { error: 'rate limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.reset - Date.now()) / 1000)) },
      },
    );
  }

  let body: { url?: string };
  try {
    body = (await req.json()) as { url?: string };
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  if (typeof body.url !== 'string' || body.url.length === 0) {
    return NextResponse.json({ error: 'url required' }, { status: 400 });
  }

  const parsed = parseUrl(body.url);
  if (!parsed) return NextResponse.json({ error: 'invalid url' }, { status: 400 });

  try {
    const { result } = await ogs({ url: parsed.url, timeout: 8000 });
    const ogImages = (result.ogImage as OgImage[] | undefined) ?? [];
    const twImages = (result.twitterImage as OgImage[] | undefined) ?? [];
    return NextResponse.json({
      kind: parsed.kind,
      host: parsed.host,
      title: result.ogTitle ?? result.twitterTitle ?? '',
      description: result.ogDescription ?? result.twitterDescription ?? '',
      image: ogImages[0]?.url ?? twImages[0]?.url ?? null,
      tweetId: parsed.tweetId ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      {
        kind: parsed.kind,
        host: parsed.host,
        tweetId: parsed.tweetId ?? null,
        error: e instanceof Error ? e.message : 'og fetch failed',
      },
      { status: 200 },
    );
  }
}
