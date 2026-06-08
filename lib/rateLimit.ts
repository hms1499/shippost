import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export type LimiterName =
  | 'url-preview'
  | 'refund-request'
  | 'free-preview'
  | 'free-preview-ip'
  | 'free-preview-global';

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
  if (!perWallet || !perIp || !global) return { allowed: false, reason: 'unavailable' };
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
    return { allowed: false, reason: 'unavailable' };
  }
}
