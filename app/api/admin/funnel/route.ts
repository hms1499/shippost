import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { computeFunnel, type FunnelRow } from '@/lib/funnelReport';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_DAYS = 90;
const DEFAULT_DAYS = 7;

export async function GET(req: Request) {
  const expected = process.env.REFUND_ADMIN_KEY;
  if (!expected) {
    return NextResponse.json({ error: 'admin not configured' }, { status: 503 });
  }
  if (req.headers.get('x-admin-key') !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const daysParam = Number(url.searchParams.get('days'));
  const days = Number.isFinite(daysParam) && daysParam > 0
    ? Math.min(daysParam, MAX_DAYS)
    : DEFAULT_DAYS;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from('funnel_events')
      .select('session_id,stage,mode')
      .gte('created_at', since);
    if (error) throw new Error(error.message);

    const report = computeFunnel((data ?? []) as FunnelRow[]);
    return NextResponse.json({ days, ...report });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'unknown' },
      { status: 500 },
    );
  }
}
