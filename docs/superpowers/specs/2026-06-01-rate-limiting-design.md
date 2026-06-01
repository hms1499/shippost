# Rate limiting for open pre-auth routes — design

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan

## Problem

Two API routes accept requests with no on-chain payment gate and can be abused:

- **`POST /api/url-preview`** — makes an outbound fetch to a caller-supplied URL
  via `open-graph-scraper`. An open server-side fetch is an amplification / SSRF
  surface; `parseUrl` validates the URL shape but does not bound request volume.
- **`POST /api/refund-request`** — looks up the thread in Supabase to verify the
  caller paid, then upserts a `refund_requests` row. It already has strong
  logical guards (paid-check → 403, `onConflict` dedupe), but an attacker can
  still spam random `walletAddress` / `onchainThreadId` pairs, each costing one
  Supabase read.

There is no rate limiting anywhere in the app (no `middleware.ts`), and the app
runs on Vercel serverless where each function instance has its own memory — so
an in-process counter is not shared across instances and cannot enforce a real
global limit.

The money path (`/api/generate/stream`) is out of scope: it is already gated by
on-chain payment verification. It may be added later.

## Goals

- Bound request volume per client IP on the two open routes above.
- Correct under Vercel's multi-instance serverless model (shared counter).
- Never take an endpoint offline because the limiter itself is misconfigured or
  unreachable — degrade open, consistent with the existing Supabase degraded
  mode in `/api/generate/stream`.

## Non-goals (YAGNI)

- Per-wallet limiting (these routes are pre-auth; IP is the right key).
- A global `middleware.ts` — only two routes need this; explicit per-route
  integration is clearer.
- Dynamic / configurable limits, an analytics dashboard, `Retry-After` backoff
  tuning beyond a basic header.
- Rate-limiting `/api/generate/stream` (payment-gated; revisit separately).

## Approach

Use **Upstash Redis** via `@upstash/ratelimit` + `@upstash/redis` — the
Vercel-recommended pattern for serverless rate limiting. A sliding-window
counter lives in Upstash and is shared across all function instances. Provision
Upstash through the Vercel Marketplace integration, which auto-sets the env
vars.

### Module: `lib/rateLimit.ts`

A single-purpose wrapper, testable in isolation.

- Lazily constructs a `Redis` client from `UPSTASH_REDIS_REST_URL` and
  `UPSTASH_REDIS_REST_TOKEN`. Construction is memoized so it happens once per
  instance.
- Defines two named sliding-window limiters:
  - `url-preview`: **10 requests / 60s** per IP (stricter — outbound fetch).
  - `refund-request`: **5 requests / 60s** per IP.
- Exports `checkRateLimit(identifier: string, limiter: LimiterName): Promise<RateLimitResult>`
  where `RateLimitResult = { success: boolean; limit: number; remaining: number; reset: number }`.
- **Fail-open semantics:**
  - If the env vars are missing (local dev, or not yet provisioned) → return
    `{ success: true, ... }` without touching Redis, and `console.warn` once.
  - If the Upstash call throws (network/outage) → catch, return
    `{ success: true, ... }`, and `console.error`. A limiter outage must not
    break the endpoint.
- Exports `getClientIp(req: Request): string` — reads the first entry of the
  `x-forwarded-for` header (Vercel sets it), falling back to a constant
  sentinel (e.g. `'unknown'`) so a missing header buckets together rather than
  crashing.

### Route integration

At the top of each `POST` handler, **before** any fetch or Supabase call:

```ts
const ip = getClientIp(req);
const rl = await checkRateLimit(ip, 'url-preview'); // or 'refund-request'
if (!rl.success) {
  return NextResponse.json(
    { error: 'rate limited' },
    { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.reset - Date.now()) / 1000)) } },
  );
}
```

The limiter check is the **first statement** in both handlers — before
`req.json()` — since `getClientIp` only needs headers. This way even
malformed-body spam is bounded, and no parse/fetch/DB work runs for a
rate-limited caller. Consistent across both routes.

## Data flow

```
client → route POST handler
       → getClientIp(req)
       → checkRateLimit(ip, limiter)
            → [env present] Upstash sliding-window INCR → {success}
            → [env missing or throw] fail-open {success: true}
       → success ? continue : 429 + Retry-After
```

## Error handling

| Condition                     | Behavior                                  |
|-------------------------------|-------------------------------------------|
| Under limit                   | allow                                     |
| Over limit                    | 429 + `Retry-After`                       |
| Env vars missing              | fail-open (allow), warn once              |
| Upstash request throws        | fail-open (allow), log error              |
| Missing `x-forwarded-for`     | bucket under `'unknown'`                  |

## Testing

`lib/rateLimit.test.ts` (vitest, mocking `@upstash/ratelimit` and
`@upstash/redis`):

- Configured + under limit → `success: true`.
- Configured + over limit → `success: false`.
- Missing env vars → `success: true` **and** Redis is never constructed/called
  (assert the mock was not invoked).
- Upstash call throws → `success: true` (fail-open), error logged.
- `getClientIp`: parses first IP from `x-forwarded-for`; falls back to sentinel
  when absent.

CI already runs `pnpm test:lib`, so these run automatically.

## Env / dependencies

- Add dependencies: `@upstash/ratelimit`, `@upstash/redis`.
- Add to `.env.example`: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`.
- Provisioning: Vercel Marketplace → Upstash (Redis), which auto-populates the
  two env vars in the linked project. Document the steps in the PR / README.

## Files touched

- `lib/rateLimit.ts` (new)
- `lib/rateLimit.test.ts` (new)
- `app/api/url-preview/route.ts` (add check)
- `app/api/refund-request/route.ts` (add check)
- `.env.example` (two new vars)
- `package.json` (two new deps)
