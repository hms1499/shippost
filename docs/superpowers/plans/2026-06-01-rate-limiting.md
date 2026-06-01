# Rate Limiting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add IP-based sliding-window rate limiting to the two open pre-auth routes (`/api/url-preview`, `/api/refund-request`), backed by Upstash Redis, failing open when unconfigured.

**Architecture:** A single `lib/rateLimit.ts` module wraps `@upstash/ratelimit` + `@upstash/redis`. It lazily builds a shared Redis client from env vars, exposes `checkRateLimit(ip, name)` with two named limiters, and `getClientIp(req)`. If env is missing or Upstash throws, it returns a success result (fail-open) so a limiter outage never takes an endpoint offline — mirroring the existing Supabase degraded mode. Each route calls the limiter as its first statement and returns `429` on rejection.

**Tech Stack:** Next.js 14 App Router (route handlers), TypeScript, Upstash Redis, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-01-rate-limiting-design.md`

---

## Pre-existing working-tree state (read before Task 1)

`package.json` and `scripts/withdraw-agent.ts` already have **uncommitted** changes from prior work (a `tools:collect` script alias + the collect-celo tool — unrelated WIP, do NOT commit them). Task 1 stashes them around `pnpm add` so the dependency commit stays clean, then restores them.

---

### Task 1: Add dependencies and env vars

**Files:**
- Modify: `package.json` (dependencies — via `pnpm add`)
- Modify: `pnpm-lock.yaml` (via `pnpm add`)
- Modify: `.env.example`

- [ ] **Step 1: Stash the unrelated pre-existing WIP so the deps commit is clean**

Run:
```bash
git stash push -m "wip-collect-tool (rate-limit plan)" -- package.json scripts/withdraw-agent.ts
git status --short
```
Expected: `package.json` and `scripts/withdraw-agent.ts` no longer appear as modified; working tree clean (aside from untracked plan/spec already committed).

- [ ] **Step 2: Install Upstash packages**

Run:
```bash
pnpm add @upstash/ratelimit @upstash/redis
```
Expected: both added under `dependencies` in `package.json`; `pnpm-lock.yaml` updated. No errors.

- [ ] **Step 3: Add the two env vars to `.env.example`**

Append these lines to `.env.example`:
```bash
# Upstash Redis — rate limiting for open pre-auth routes (url-preview, refund-request).
# Provision via Vercel Marketplace → Upstash (Redis); it auto-sets these.
# If unset, rate limiting fails open (disabled) — fine for local dev.
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
```

- [ ] **Step 4: Verify typecheck still passes**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 5: Commit the dependency + env change**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "build: add Upstash deps and rate-limit env vars

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 6: Restore the pre-existing WIP**

Run:
```bash
git stash pop
git status --short
```
Expected: `package.json` and `scripts/withdraw-agent.ts` reappear as modified (` M`). If `git stash pop` reports a conflict in `package.json` (different regions, unlikely), keep BOTH the new `dependencies` lines and the pre-existing `tools:collect` script line, then `git add` is NOT needed (leave unstaged — it is WIP).

---

### Task 2: `lib/rateLimit.ts` module (TDD)

**Files:**
- Create: `lib/rateLimit.ts`
- Test: `lib/rateLimit.test.ts`

Run tests with `pnpm test:lib` (the `vitest run lib` script picks up `lib/**/*.test.ts`).

- [ ] **Step 1: Write the failing test**

Create `lib/rateLimit.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoisted mock fns so the vi.mock factories (hoisted above imports) can close
// over them.
const { limitMock, redisCtor, slidingWindowMock } = vi.hoisted(() => ({
  limitMock: vi.fn(),
  redisCtor: vi.fn(),
  slidingWindowMock: vi.fn((tokens: number, window: string) => ({ tokens, window })),
}));

vi.mock('@upstash/redis', () => ({
  Redis: class {
    constructor(opts: unknown) {
      redisCtor(opts);
    }
  },
}));

vi.mock('@upstash/ratelimit', () => ({
  Ratelimit: class {
    limit = limitMock;
    constructor(_opts: unknown) {}
    static slidingWindow = slidingWindowMock;
  },
}));

// rateLimit.ts memoizes the Redis client + limiters at module scope, so each
// test needs a fresh module instance to exercise env-dependent construction.
async function load() {
  vi.resetModules();
  return import('./rateLimit');
}

const ORIG_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIG_ENV };
});

function setUpstashEnv() {
  process.env.UPSTASH_REDIS_REST_URL = 'https://example.upstash.io';
  process.env.UPSTASH_REDIS_REST_TOKEN = 'token';
}

function clearUpstashEnv() {
  delete process.env.UPSTASH_REDIS_REST_URL;
  delete process.env.UPSTASH_REDIS_REST_TOKEN;
}

describe('checkRateLimit', () => {
  it('allows when under the limit (env configured)', async () => {
    setUpstashEnv();
    limitMock.mockResolvedValue({ success: true, limit: 10, remaining: 9, reset: 123 });
    const { checkRateLimit } = await load();

    const res = await checkRateLimit('1.2.3.4', 'url-preview');

    expect(res.success).toBe(true);
    expect(redisCtor).toHaveBeenCalledTimes(1);
    expect(slidingWindowMock).toHaveBeenCalledWith(10, '60 s');
    expect(limitMock).toHaveBeenCalledWith('1.2.3.4');
  });

  it('denies when over the limit', async () => {
    setUpstashEnv();
    limitMock.mockResolvedValue({ success: false, limit: 5, remaining: 0, reset: 999 });
    const { checkRateLimit } = await load();

    const res = await checkRateLimit('1.2.3.4', 'refund-request');

    expect(res.success).toBe(false);
    expect(slidingWindowMock).toHaveBeenCalledWith(5, '60 s');
  });

  it('fails open and never touches Redis when env is missing', async () => {
    clearUpstashEnv();
    const { checkRateLimit } = await load();

    const res = await checkRateLimit('1.2.3.4', 'url-preview');

    expect(res.success).toBe(true);
    expect(redisCtor).not.toHaveBeenCalled();
    expect(limitMock).not.toHaveBeenCalled();
  });

  it('fails open when the limiter throws', async () => {
    setUpstashEnv();
    limitMock.mockRejectedValue(new Error('upstash down'));
    const { checkRateLimit } = await load();

    const res = await checkRateLimit('1.2.3.4', 'url-preview');

    expect(res.success).toBe(true);
  });
});

describe('getClientIp', () => {
  it('returns the first IP from x-forwarded-for', async () => {
    const { getClientIp } = await load();
    const req = new Request('https://x', {
      headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' },
    });
    expect(getClientIp(req)).toBe('9.9.9.9');
  });

  it('falls back to "unknown" when the header is absent', async () => {
    const { getClientIp } = await load();
    const req = new Request('https://x');
    expect(getClientIp(req)).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:lib`
Expected: FAIL — `lib/rateLimit.test.ts` cannot resolve `./rateLimit` (module does not exist yet).

- [ ] **Step 3: Write the implementation**

Create `lib/rateLimit.ts`:
```ts
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

export type LimiterName = 'url-preview' | 'refund-request';

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // unix ms when the window resets
}

// Per-route sliding-window budgets. url-preview is stricter because it makes an
// outbound server-side fetch.
const LIMITS: Record<LimiterName, { tokens: number; window: `${number} s` }> = {
  'url-preview': { tokens: 10, window: '60 s' },
  'refund-request': { tokens: 5, window: '60 s' },
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:lib`
Expected: PASS — all `rateLimit` cases green, plus the existing suites (orchestrator, retry, threadParser, modeB).

- [ ] **Step 5: Commit**

```bash
git add lib/rateLimit.ts lib/rateLimit.test.ts
git commit -m "feat(ratelimit): add Upstash-backed limiter with fail-open

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Integrate into `/api/url-preview`

**Files:**
- Modify: `app/api/url-preview/route.ts`

- [ ] **Step 1: Add the import**

In `app/api/url-preview/route.ts`, change the import block so the third line becomes two lines:
```ts
import { NextResponse } from 'next/server';
import ogs from 'open-graph-scraper';
import { parseUrl } from '@/lib/urlParser';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
```

- [ ] **Step 2: Add the limiter check as the first statement in POST**

In the same file, replace the start of the handler:
```ts
export async function POST(req: Request) {
  let body: { url?: string };
```
with:
```ts
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
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 4: Commit**

```bash
git add app/api/url-preview/route.ts
git commit -m "feat(ratelimit): guard /api/url-preview (10/60s per IP)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Integrate into `/api/refund-request`

**Files:**
- Modify: `app/api/refund-request/route.ts`

- [ ] **Step 1: Add the import**

In `app/api/refund-request/route.ts`, add the import after the supabase import:
```ts
import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabase';
import { checkRateLimit, getClientIp } from '@/lib/rateLimit';
```

- [ ] **Step 2: Add the limiter check as the first statement in POST**

Replace the start of the handler:
```ts
export async function POST(req: Request) {
  let body: Body;
```
with:
```ts
export async function POST(req: Request) {
  const rl = await checkRateLimit(getClientIp(req), 'refund-request');
  if (!rl.success) {
    return NextResponse.json(
      { error: 'rate limited' },
      {
        status: 429,
        headers: { 'Retry-After': String(Math.ceil((rl.reset - Date.now()) / 1000)) },
      },
    );
  }

  let body: Body;
```

- [ ] **Step 3: Verify typecheck passes**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 4: Commit**

```bash
git add app/api/refund-request/route.ts
git commit -m "feat(ratelimit): guard /api/refund-request (5/60s per IP)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Full verification gate

No code changes — confirm the whole suite and a production build are green with the new dependency and routes in place.

- [ ] **Step 1: Run the library test suite**

Run: `pnpm test:lib`
Expected: PASS, including the new `rateLimit` cases.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: `✓ Compiled successfully`, route table lists `/api/url-preview` and `/api/refund-request`, no errors. (Build needs no secrets; rate limiting fails open without Upstash env.)

- [ ] **Step 4: Confirm no stray changes**

Run: `git status --short`
Expected: only the pre-existing WIP (` M package.json`, ` M scripts/withdraw-agent.ts`) remains uncommitted. All rate-limiting work is committed.

---

## Post-implementation note (for the human, not a task)

To activate rate limiting in production: provision Upstash Redis via the Vercel Marketplace integration (auto-sets `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` on the linked project), then redeploy. Until then the limiter fails open (disabled), which is the intended local-dev / unprovisioned behavior.
