import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { reconcileStuckThreads } from '@/lib/agent/reconcile';
import { alertOps } from '@/lib/alert';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Scheduled sweeper (see vercel.json crons). Recovers threads stuck in
// status='pending' — paid, never delivered, never refunded — by queuing a
// slow-cancel refund and flipping them to 'failed'. Never sends money; a human
// still drains the queue. Vercel Cron authenticates with the Authorization:
// Bearer $CRON_SECRET header it injects when CRON_SECRET is set.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'cron not configured' }, { status: 503 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await reconcileStuckThreads(getSupabaseServer());

    if (result.swept > 0 || result.errors.length > 0) {
      await alertOps(
        `reconcile: swept ${result.swept} stuck thread(s), enqueued ${result.enqueued} refund(s)` +
          (result.errors.length ? `, ${result.errors.length} error(s)` : ''),
        result,
      );
    }

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await alertOps('reconcile cron crashed', { error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
