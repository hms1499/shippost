import { getSupabaseServer } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
import {
  isFunnelStage,
  isValidMode,
  UUID_RE,
  WALLET_RE,
  type FunnelEventInput,
} from '@/lib/funnelTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Analytics ingest: NEVER 5xx to the client and never block the flow. Every
// path — invalid body, over-limit, DB down — returns 202 and silently drops.
const accepted = () => new Response(null, { status: 202 });

function getSupabaseSafe() {
  try {
    return getSupabaseServer();
  } catch {
    return null;
  }
}

// Returns a sanitized row, or null if the body isn't a valid event.
function parse(body: unknown): Record<string, unknown> | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Partial<FunnelEventInput>;
  if (typeof b.session_id !== 'string' || !UUID_RE.test(b.session_id)) return null;
  if (!isFunnelStage(b.stage)) return null;
  if (!isValidMode(b.mode)) return null;
  if (b.chain_id != null && typeof b.chain_id !== 'number') return null;
  if (b.wallet_address != null && !WALLET_RE.test(b.wallet_address)) return null;
  return {
    session_id: b.session_id,
    stage: b.stage,
    mode: b.mode ?? null,
    chain_id: typeof b.chain_id === 'number' ? b.chain_id : null,
    wallet_address: b.wallet_address ? b.wallet_address.toLowerCase() : null,
  };
}

export async function POST(req: Request) {
  // Per-IP bound on a public write endpoint; fail closed (drop) when exceeded.
  const limit = await checkRateLimit(getClientIp(req), 'funnel-ingest');
  if (!limit.success) return accepted();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return accepted();
  }

  const row = parse(body);
  if (!row) return accepted();

  const supabase = getSupabaseSafe();
  if (!supabase) return accepted();

  try {
    await supabase.from('funnel_events').insert(row);
  } catch {
    // swallow — analytics loss is acceptable
  }
  return accepted();
}
