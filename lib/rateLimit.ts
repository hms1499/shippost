import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { alertOps } from '@/lib/alert';

export type LimiterName =
  | 'url-preview'
  | 'refund-request'
  | 'free-preview'
  | 'free-preview-ip'
  | 'free-preview-global'
  | 'funnel-ingest';

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // unix ms when the window resets
}

// Global daily cap protects the Serper free tier (env-tunable).
const PREVIEW_DAILY_CAP = Number(process.env.PREVIEW_DAILY_CAP) || 500;

// Per-route sliding-window budgets. url-preview is stricter because it makes an
// outbound server-side fetch.
const LIMITS: Record<LimiterName, { tokens: number; window: `${number} s` }> = {
  'url-preview': { tokens: 10, window: '60 s' },
  'refund-request': { tokens: 5, window: '60 s' },
  'free-preview': { tokens: 3, window: '600 s' },
  // Per-IP is the real abuse bound: walletAddress is client-supplied and
  // forgeable, so the per-wallet limit alone lets one IP rotate addresses and
  // drain the global budget. Slightly looser than per-wallet to tolerate shared
  // NAT (a few real users behind one IP).
  'free-preview-ip': { tokens: 10, window: '600 s' },
  'free-preview-global': { tokens: PREVIEW_DAILY_CAP, window: '86400 s' },
  'funnel-ingest': { tokens: 60, window: '60 s' },
};

// Fail-open result: returned whenever rate limiting is unavailable so a limiter
// outage or missing config never takes the endpoint offline.
function allow(name: LimiterName): RateLimitResult {
  const { tokens } = LIMITS[name];
  return { success: true, limit: tokens, remaining: tokens, reset: Date.now() };
}

let redis: Redis | null = null;
let warned = false;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warned) {
      console.warn('[rateLimit] Upstash env not set — rate limiting disabled (fail-open)');
      warned = true;
    }
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

const limiters = new Map<LimiterName, Ratelimit>();

function getLimiter(name: LimiterName): Ratelimit | null {
  const cached = limiters.get(name);
  if (cached) return cached;
  const r = getRedis();
  if (!r) return null;
  const { tokens, window } = LIMITS[name];
  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(tokens, window),
    prefix: `ratelimit:${name}`,
  });
  limiters.set(name, limiter);
  return limiter;
}

export async function checkRateLimit(
  identifier: string,
  name: LimiterName,
): Promise<RateLimitResult> {
  const limiter = getLimiter(name);
  if (!limiter) return allow(name); // env missing → fail-open
  try {
    const { success, limit, remaining, reset } = await limiter.limit(identifier);
    return { success, limit, remaining, reset };
  } catch (e) {
    console.error(
      '[rateLimit] limiter error — failing open:',
      e instanceof Error ? e.message : e,
    );
    return allow(name);
  }
}

export type GenerationClaim = 'claimed' | 'replay' | 'unavailable';

// Backstop replay guard for the paid generate route. The primary guard is the
// unique (chain_id, onchain_thread_id) index in Supabase, inserted before any
// spend. When Supabase is unreachable that insert is skipped (degraded mode),
// leaving a window where the same payTxHash could be replayed to spend x402
// repeatedly for one payment. A Redis SET NX (1h TTL — well past the 150s
// pipeline) closes that window cheaply. Fails OPEN ('unavailable') when Redis
// is also down, matching checkRateLimit: a dual outage degrades to
// verifyPayment + the on-chain daily cap rather than taking generation fully
// offline.
export async function claimGenerationOnce(key: string): Promise<GenerationClaim> {
  const r = getRedis();
  if (!r) return 'unavailable';
  try {
    const res = await r.set(`generate:claim:${key}`, '1', { nx: true, ex: 3600 });
    return res === 'OK' ? 'claimed' : 'replay';
  } catch (e) {
    console.error(
      '[rateLimit] generation claim error — failing open:',
      e instanceof Error ? e.message : e,
    );
    return 'unavailable';
  }
}

// Throttle for recurring ops alerts (e.g. the wallet-low heartbeat that fires
// every 15 min). SET NX with a TTL: the first caller within the window claims
// the key and alerts; the rest are suppressed until it expires. Fails OPEN —
// when Redis is missing or errors we alert anyway, because missing a low-balance
// page is worse than sending a duplicate.
export async function claimAlertOnce(key: string, ttlSec: number): Promise<boolean> {
  const r = getRedis();
  if (!r) return true;
  try {
    const res = await r.set(`alert:once:${key}`, '1', { nx: true, ex: ttlSec });
    return res === 'OK';
  } catch (e) {
    console.error(
      '[rateLimit] alert-once error — alerting anyway:',
      e instanceof Error ? e.message : e,
    );
    return true;
  }
}

// Vercel sets x-forwarded-for; take the client (first) entry. Missing header
// buckets together under a sentinel rather than throwing.
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

export interface PreviewGate {
  allowed: boolean;
  reason?: 'rate' | 'ip' | 'global' | 'unavailable';
}

// A fail-CLOSED preview gate hands the caller {available:false} + HTTP 200 — a
// valid-looking answer, not an error — so nothing else pages a human. Upstash
// env was missing on prod for days and the free preview was dead the whole time
// in silence. Alert on the outage, but NOT via claimAlertOnce: that throttle is
// Redis-backed and fails open, and Redis is exactly what is down here, so it
// would alert on every request. Throttle in-process instead — one page per
// window per lambda instance is noisy enough to notice, quiet enough to ignore.
const OUTAGE_ALERT_INTERVAL_MS = 15 * 60 * 1000;
let lastOutageAlertMs = 0;

function alertPreviewOutage(cause: string, e?: unknown): void {
  const now = Date.now();
  if (now - lastOutageAlertMs < OUTAGE_ALERT_INTERVAL_MS) return;
  lastOutageAlertMs = now;
  void alertOps('free preview is DOWN — gate failing closed, every caller denied', {
    cause,
    error: e instanceof Error ? e.message : e ? String(e) : undefined,
  });
}

// Preview consumes shared third-party quota, so unlike checkRateLimit this
// fails CLOSED: if the limiter can't be reached we deny rather than allow.
// Order matters: per-wallet then per-IP, and the global daily budget LAST — so
// a request we'd reject on wallet/IP never depletes the shared budget. Per-IP
// is the real bound (walletAddress is forgeable); per-wallet still helps when
// the address is stable.
export async function checkPreviewAllowed(walletAddress: string, ip: string): Promise<PreviewGate> {
  const perWallet = getLimiter('free-preview');
  const perIp = getLimiter('free-preview-ip');
  const global = getLimiter('free-preview-global');
  if (!perWallet || !perIp || !global) {
    alertPreviewOutage('upstash-env-missing');
    return { allowed: false, reason: 'unavailable' };
  }
  try {
    const w = await perWallet.limit(`wallet:${walletAddress.toLowerCase()}`);
    if (!w.success) return { allowed: false, reason: 'rate' };
    const i = await perIp.limit(`ip:${ip}`);
    if (!i.success) return { allowed: false, reason: 'ip' };
    const g = await global.limit('global');
    if (!g.success) return { allowed: false, reason: 'global' };
    return { allowed: true };
  } catch (e) {
    console.error(
      '[rateLimit] preview gate error — failing closed:',
      e instanceof Error ? e.message : e,
    );
    alertPreviewOutage('limiter-error', e);
    return { allowed: false, reason: 'unavailable' };
  }
}

// Guest variant for the pre-connect landing taste: no wallet exists yet, so we
// gate on per-IP + the global daily budget only. runPreview stays settle-free
// (no x402, no agent spend, no persisted row), so relaxing identity adds no new
// spend path — the per-IP + global caps are the whole abuse bound. Same
// fail-CLOSED discipline as checkPreviewAllowed, and per-IP runs first so a
// request we'd reject never depletes the shared global budget.
export async function checkPreviewGuestAllowed(ip: string): Promise<PreviewGate> {
  const perIp = getLimiter('free-preview-ip');
  const global = getLimiter('free-preview-global');
  if (!perIp || !global) {
    alertPreviewOutage('upstash-env-missing');
    return { allowed: false, reason: 'unavailable' };
  }
  try {
    const i = await perIp.limit(`ip:${ip}`);
    if (!i.success) return { allowed: false, reason: 'ip' };
    const g = await global.limit('global');
    if (!g.success) return { allowed: false, reason: 'global' };
    return { allowed: true };
  } catch (e) {
    console.error(
      '[rateLimit] guest preview gate error — failing closed:',
      e instanceof Error ? e.message : e,
    );
    alertPreviewOutage('limiter-error', e);
    return { allowed: false, reason: 'unavailable' };
  }
}
