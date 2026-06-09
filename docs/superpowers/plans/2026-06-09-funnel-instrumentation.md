# Funnel Instrumentation (C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track per-session drop-off across `connect → mode_select → submit → preview → pay → share` and expose stage conversion + which mode converts best, via an admin-only endpoint, with no PII.

**Architecture:** A client emitter (`lib/funnel.ts`) fires anonymous session-keyed events through `navigator.sendBeacon` to a strict, fail-closed public ingest route, which writes one row per event into a new `funnel_events` table. A pure `computeFunnel()` turns the rows into conversion + per-mode stats, served behind an admin key.

**Tech Stack:** Next.js App Router route handlers, Supabase (service-role), Upstash rate limiter, Vitest. Follows existing patterns in `app/api/refund/route.ts` (admin key), `lib/rateLimit.ts`, and `supabase/migrations/`.

**Spec:** `docs/superpowers/specs/2026-06-09-funnel-instrumentation-design.md`

---

## File Structure

- Create `lib/funnelTypes.ts` — isomorphic constants/types/validators (no `'use client'`), shared by client + server. One responsibility: the funnel vocabulary.
- Create `lib/funnel.ts` — `'use client'` emitter (session id, payload, transport, `track`).
- Create `app/api/public/funnel/route.ts` — public ingest (validate, rate-limit, insert).
- Create `lib/funnelReport.ts` — pure `computeFunnel(rows)`.
- Create `app/api/admin/funnel/route.ts` — admin read (auth, window, aggregate).
- Create `supabase/migrations/0006_funnel_events.sql` — the table.
- Modify `lib/rateLimit.ts` — add the `funnel-ingest` limiter.
- Modify `app/HomeClient.tsx` — call `track()` at the six transitions.
- Tests: `lib/funnelTypes.test.ts`, `lib/funnel.test.ts`, `app/api/public/funnel/route.test.ts`, `lib/funnelReport.test.ts`, `app/api/admin/funnel/route.test.ts`.

---

## Task 1: Shared funnel vocabulary (`lib/funnelTypes.ts`)

**Files:**
- Create: `lib/funnelTypes.ts`
- Test: `lib/funnelTypes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// lib/funnelTypes.test.ts
import { describe, it, expect } from 'vitest';
import {
  FUNNEL_STAGES,
  isFunnelStage,
  isValidMode,
  UUID_RE,
  WALLET_RE,
} from './funnelTypes';

describe('funnelTypes', () => {
  it('lists the six stages in funnel order', () => {
    expect(FUNNEL_STAGES).toEqual([
      'connect',
      'mode_select',
      'submit',
      'preview',
      'pay',
      'share',
    ]);
  });

  it('isFunnelStage accepts known stages and rejects others', () => {
    expect(isFunnelStage('pay')).toBe(true);
    expect(isFunnelStage('checkout')).toBe(false);
    expect(isFunnelStage(42)).toBe(false);
  });

  it('isValidMode accepts 0,1,2 and null/undefined, rejects the rest', () => {
    expect(isValidMode(0)).toBe(true);
    expect(isValidMode(2)).toBe(true);
    expect(isValidMode(null)).toBe(true);
    expect(isValidMode(undefined)).toBe(true);
    expect(isValidMode(3)).toBe(false);
    expect(isValidMode('1')).toBe(false);
  });

  it('UUID_RE matches a v4-shaped id and rejects junk', () => {
    expect(UUID_RE.test('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(UUID_RE.test('not-a-uuid')).toBe(false);
  });

  it('WALLET_RE matches a 0x address and rejects junk', () => {
    expect(WALLET_RE.test('0x' + 'a'.repeat(40))).toBe(true);
    expect(WALLET_RE.test('0x123')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:lib -- lib/funnelTypes.test.ts`
Expected: FAIL — cannot find module `./funnelTypes`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/funnelTypes.ts
// Isomorphic funnel vocabulary shared by the client emitter (lib/funnel.ts),
// the ingest route, and the report. No 'use client' / no server imports so it
// is safe on both sides.

export const FUNNEL_STAGES = [
  'connect',
  'mode_select',
  'submit',
  'preview',
  'pay',
  'share',
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export function isFunnelStage(v: unknown): v is FunnelStage {
  return typeof v === 'string' && (FUNNEL_STAGES as readonly string[]).includes(v);
}

export function isValidMode(v: unknown): v is 0 | 1 | 2 | null | undefined {
  return v === null || v === undefined || v === 0 || v === 1 || v === 2;
}

// The wire shape the client sends and the ingest route validates.
export interface FunnelEventInput {
  session_id: string;
  stage: FunnelStage;
  mode?: 0 | 1 | 2 | null;
  chain_id?: number | null;
  wallet_address?: string | null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:lib -- lib/funnelTypes.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/funnelTypes.ts lib/funnelTypes.test.ts
git commit -m "feat(funnel): shared funnel vocabulary + validators (C1)"
```

---

## Task 2: Client emitter (`lib/funnel.ts`)

**Files:**
- Create: `lib/funnel.ts`
- Test: `lib/funnel.test.ts`

Design seams kept pure for testing: `buildPayload()` produces the wire object; `track()` resolves the session id, picks a transport (sendBeacon → fetch fallback), and swallows all errors. SSR (no `window`) → no-op.

- [ ] **Step 1: Write the failing test**

```ts
// lib/funnel.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPayload, track, __resetSessionIdForTests } from './funnel';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('buildPayload', () => {
  it('includes session id + stage and only known optional fields', () => {
    const p = buildPayload('sid-1', 'pay', { mode: 1, chainId: 42220, wallet: '0xAbC' });
    expect(p).toEqual({
      session_id: 'sid-1',
      stage: 'pay',
      mode: 1,
      chain_id: 42220,
      wallet_address: '0xabc', // lowercased
    });
  });

  it('omits absent optional fields (no nulls for missing data)', () => {
    expect(buildPayload('sid-1', 'connect')).toEqual({
      session_id: 'sid-1',
      stage: 'connect',
    });
  });
});

describe('track', () => {
  beforeEach(() => {
    __resetSessionIdForTests();
  });

  it('is a no-op on the server (no window)', () => {
    vi.stubGlobal('window', undefined);
    expect(() => track('connect')).not.toThrow();
  });

  it('sends via sendBeacon when available', () => {
    const sendBeacon = vi.fn(() => true);
    const store: Record<string, string> = {};
    vi.stubGlobal('window', { navigator: { sendBeacon } });
    vi.stubGlobal('navigator', { sendBeacon });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    vi.stubGlobal('crypto', { randomUUID: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });

    track('mode_select', { mode: 0 });

    expect(sendBeacon).toHaveBeenCalledOnce();
    const [url, body] = sendBeacon.mock.calls[0];
    expect(url).toBe('/api/public/funnel');
    expect(body).toBeInstanceOf(Blob);
  });

  it('falls back to fetch(keepalive) when sendBeacon is missing', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
    const store: Record<string, string> = {};
    vi.stubGlobal('window', { navigator: {} });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    vi.stubGlobal('crypto', { randomUUID: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });

    track('submit', { mode: 2 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/public/funnel');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('never throws if the transport errors', () => {
    vi.stubGlobal('window', { navigator: {} });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', () => { throw new Error('network'); });
    const store: Record<string, string> = {};
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    vi.stubGlobal('crypto', { randomUUID: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });

    expect(() => track('share')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:lib -- lib/funnel.test.ts`
Expected: FAIL — cannot find module `./funnel`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/funnel.ts
'use client';

import { FunnelStage, FunnelEventInput } from './funnelTypes';

const ENDPOINT = '/api/public/funnel';
const SID_KEY = 'shippost.funnel.sid';

let cachedSid: string | null = null;

// Test-only: clear the module-level session cache between cases.
export function __resetSessionIdForTests(): void {
  cachedSid = null;
}

function getSessionId(): string | null {
  if (cachedSid) return cachedSid;
  try {
    const existing = sessionStorage.getItem(SID_KEY);
    if (existing) {
      cachedSid = existing;
      return existing;
    }
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(SID_KEY, fresh);
    cachedSid = fresh;
    return fresh;
  } catch {
    return null; // storage blocked → don't track rather than crash
  }
}

export function buildPayload(
  sessionId: string,
  stage: FunnelStage,
  opts: { mode?: number | null; chainId?: number | null; wallet?: string | null } = {},
): FunnelEventInput {
  const payload: FunnelEventInput = { session_id: sessionId, stage };
  if (opts.mode === 0 || opts.mode === 1 || opts.mode === 2) payload.mode = opts.mode;
  if (typeof opts.chainId === 'number') payload.chain_id = opts.chainId;
  if (opts.wallet) payload.wallet_address = opts.wallet.toLowerCase();
  return payload;
}

// Fire-and-forget. Survives navigation/unload via sendBeacon; falls back to
// keepalive fetch. Any failure (SSR, blocked storage, network) is swallowed —
// analytics must never break the flow.
export function track(
  stage: FunnelStage,
  opts: { mode?: number | null; chainId?: number | null; wallet?: string | null } = {},
): void {
  try {
    if (typeof window === 'undefined') return;
    const sid = getSessionId();
    if (!sid) return;
    const body = JSON.stringify(buildPayload(sid, stage, opts));

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {});
  } catch {
    // swallow
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:lib -- lib/funnel.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/funnel.ts lib/funnel.test.ts
git commit -m "feat(funnel): client emitter (sendBeacon + fetch fallback) (C1)"
```

---

## Task 3: Migration (`supabase/migrations/0006_funnel_events.sql`)

**Files:**
- Create: `supabase/migrations/0006_funnel_events.sql`

No automated test (raw SQL migration). Verify by reading; matches the `threads`
pattern (service-role only, no anon RLS policy).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0006_funnel_events.sql
-- Anonymous funnel events for drop-off analysis (C1). One row per stage entry,
-- keyed by a client-generated session UUID (no PII). wallet_address is
-- pseudonymous and nullable (attached from `connect` onward) so the funnel can
-- later be joined to real conversions in `threads`. Service-role only.
create table if not exists public.funnel_events (
  id             bigint generated always as identity primary key,
  session_id     text        not null,
  stage          text        not null check (stage in
                   ('connect','mode_select','submit','preview','pay','share')),
  mode           smallint    check (mode in (0,1,2)),
  chain_id       integer,
  wallet_address text,
  created_at     timestamptz not null default now()
);

create index if not exists funnel_events_stage_idx     on public.funnel_events (stage);
create index if not exists funnel_events_session_idx    on public.funnel_events (session_id);
create index if not exists funnel_events_created_at_idx on public.funnel_events (created_at);

-- No anon RLS policy: reads/writes go through the service-role client only,
-- matching `threads`. RLS stays disabled (service role bypasses it regardless).
```

- [ ] **Step 2: Verify it reads correctly**

Run: `cat supabase/migrations/0006_funnel_events.sql`
Expected: the file above; the `stage`/`mode` CHECK constraints mirror the
`funnelTypes` enum and `isValidMode`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0006_funnel_events.sql
git commit -m "feat(db): funnel_events table (C1)"
```

---

## Task 4: Ingest route + rate limiter (`app/api/public/funnel/route.ts`)

**Files:**
- Modify: `lib/rateLimit.ts` (add `funnel-ingest` to `LimiterName` and `LIMITS`)
- Create: `app/api/public/funnel/route.ts`
- Test: `app/api/public/funnel/route.test.ts`

- [ ] **Step 1: Add the `funnel-ingest` limiter**

In `lib/rateLimit.ts`, extend the `LimiterName` union (add `| 'funnel-ingest'`)
and add to the `LIMITS` record:

```ts
  'funnel-ingest': { tokens: 60, window: '60 s' },
```

- [ ] **Step 2: Write the failing test**

```ts
// app/api/public/funnel/route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkRateLimit = vi.fn();
const getClientIp = vi.fn(() => 'test-ip');
const getSupabaseServer = vi.fn();

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit, getClientIp }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));

const { POST } = await import('./route');

function makeSupabase() {
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, inserts };
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/public/funnel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID = {
  session_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  stage: 'pay',
  mode: 1,
  chain_id: 42220,
  wallet_address: '0x' + 'a'.repeat(40),
};

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ success: true });
});

describe('POST /api/public/funnel', () => {
  it('inserts a sanitized row for a valid event and returns 202', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    const res = await POST(postReq(VALID));

    expect(res.status).toBe(202);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual({
      session_id: VALID.session_id,
      stage: 'pay',
      mode: 1,
      chain_id: 42220,
      wallet_address: VALID.wallet_address,
    });
  });

  it('drops (202, no insert) when over the rate limit', async () => {
    checkRateLimit.mockResolvedValue({ success: false });
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    const res = await POST(postReq(VALID));

    expect(res.status).toBe(202);
    expect(inserts).toHaveLength(0);
  });

  it('drops (202, no insert) on an invalid stage', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    const res = await POST(postReq({ ...VALID, stage: 'checkout' }));

    expect(res.status).toBe(202);
    expect(inserts).toHaveLength(0);
  });

  it('drops (202, no insert) on a bad session id, mode, or wallet', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    await POST(postReq({ ...VALID, session_id: 'nope' }));
    await POST(postReq({ ...VALID, mode: 9 }));
    await POST(postReq({ ...VALID, wallet_address: '0x123' }));

    expect(inserts).toHaveLength(0);
  });

  it('drops absent optional fields to null in the row', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    await POST(postReq({ session_id: VALID.session_id, stage: 'connect' }));

    expect(inserts[0]).toEqual({
      session_id: VALID.session_id,
      stage: 'connect',
      mode: null,
      chain_id: null,
      wallet_address: null,
    });
  });

  it('returns 202 (never throws) on malformed JSON', async () => {
    const res = await POST(postReq('{not json'));
    expect(res.status).toBe(202);
  });

  it('returns 202 (no insert) when Supabase is unavailable', async () => {
    getSupabaseServer.mockImplementation(() => { throw new Error('no env'); });
    const res = await POST(postReq(VALID));
    expect(res.status).toBe(202);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test:lib -- app/api/public/funnel/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 4: Write minimal implementation**

```ts
// app/api/public/funnel/route.ts
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
const ACCEPTED = new Response(null, { status: 202 });

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
  if (!limit.success) return ACCEPTED;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return ACCEPTED;
  }

  const row = parse(body);
  if (!row) return ACCEPTED;

  const supabase = getSupabaseSafe();
  if (!supabase) return ACCEPTED;

  try {
    await supabase.from('funnel_events').insert(row);
  } catch {
    // swallow — analytics loss is acceptable
  }
  return ACCEPTED;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test:lib -- app/api/public/funnel/route.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/rateLimit.ts app/api/public/funnel/route.ts app/api/public/funnel/route.test.ts
git commit -m "feat(funnel): strict fail-closed ingest route + rate limiter (C1)"
```

---

## Task 5: Report aggregation (`lib/funnelReport.ts`)

**Files:**
- Create: `lib/funnelReport.ts`
- Test: `lib/funnelReport.test.ts`

`computeFunnel(rows)` takes raw event rows and returns per-stage distinct-session
counts, stage→stage conversion, and a per-mode breakdown from `mode_select` on.

- [ ] **Step 1: Write the failing test**

```ts
// lib/funnelReport.test.ts
import { describe, it, expect } from 'vitest';
import { computeFunnel, type FunnelRow } from './funnelReport';

function row(session_id: string, stage: string, mode: number | null = null): FunnelRow {
  return { session_id, stage, mode };
}

describe('computeFunnel', () => {
  it('counts distinct sessions per stage (dedupes repeats)', () => {
    const r = computeFunnel([
      row('a', 'connect'),
      row('a', 'connect'), // duplicate same session+stage
      row('b', 'connect'),
      row('a', 'mode_select', 1),
    ]);
    expect(r.perStage.connect).toBe(2);
    expect(r.perStage.mode_select).toBe(1);
    expect(r.perStage.share).toBe(0);
  });

  it('computes stage→stage conversion as a fraction of the previous stage', () => {
    const r = computeFunnel([
      row('a', 'connect'), row('b', 'connect'), row('c', 'connect'), row('d', 'connect'),
      row('a', 'mode_select', 0), row('b', 'mode_select', 0),
      row('a', 'submit', 0),
    ]);
    // connect=4, mode_select=2 → 0.5 ; mode_select=2, submit=1 → 0.5
    expect(r.conversion.mode_select).toBeCloseTo(0.5);
    expect(r.conversion.submit).toBeCloseTo(0.5);
  });

  it('never divides by zero (0 upstream → 0 conversion, not NaN)', () => {
    const r = computeFunnel([row('a', 'pay', 1)]);
    expect(r.conversion.pay).toBe(0);
    expect(Number.isNaN(r.conversion.pay)).toBe(false);
  });

  it('breaks down sessions by mode from mode_select onward', () => {
    const r = computeFunnel([
      row('a', 'mode_select', 0), row('a', 'pay', 0),
      row('b', 'mode_select', 1), row('b', 'pay', 1), row('b', 'share', 1),
      row('c', 'mode_select', 1),
    ]);
    expect(r.byMode[0].mode_select).toBe(1);
    expect(r.byMode[0].pay).toBe(1);
    expect(r.byMode[1].mode_select).toBe(2);
    expect(r.byMode[1].pay).toBe(1);
    expect(r.byMode[1].share).toBe(1);
  });

  it('handles empty input', () => {
    const r = computeFunnel([]);
    expect(r.perStage.connect).toBe(0);
    expect(r.conversion.connect).toBe(0);
    expect(r.byMode[2].pay).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:lib -- lib/funnelReport.test.ts`
Expected: FAIL — cannot find module `./funnelReport`.

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/funnelReport.ts
import { FUNNEL_STAGES, type FunnelStage } from './funnelTypes';

export interface FunnelRow {
  session_id: string;
  stage: string;
  mode: number | null;
}

type StageCounts = Record<FunnelStage, number>;

function emptyStageCounts(): StageCounts {
  return Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as StageCounts;
}

// distinct session_id per stage, from a pre-filtered row set.
function distinctPerStage(rows: FunnelRow[]): StageCounts {
  const seen: Record<string, Set<string>> = {};
  for (const s of FUNNEL_STAGES) seen[s] = new Set();
  for (const r of rows) {
    if ((FUNNEL_STAGES as readonly string[]).includes(r.stage)) {
      seen[r.stage].add(r.session_id);
    }
  }
  const out = emptyStageCounts();
  for (const s of FUNNEL_STAGES) out[s] = seen[s].size;
  return out;
}

export interface FunnelReport {
  perStage: StageCounts;
  // conversion[stage] = perStage[stage] / perStage[previous stage]; first
  // stage and any zero-upstream → 0 (never NaN).
  conversion: StageCounts;
  // byMode[0|1|2] = per-stage distinct sessions for rows with that mode.
  byMode: Record<0 | 1 | 2, StageCounts>;
}

export function computeFunnel(rows: FunnelRow[]): FunnelReport {
  const perStage = distinctPerStage(rows);

  const conversion = emptyStageCounts();
  FUNNEL_STAGES.forEach((stage, i) => {
    if (i === 0) {
      conversion[stage] = 0;
      return;
    }
    const prev = perStage[FUNNEL_STAGES[i - 1]];
    conversion[stage] = prev > 0 ? perStage[stage] / prev : 0;
  });

  const byMode = {
    0: distinctPerStage(rows.filter((r) => r.mode === 0)),
    1: distinctPerStage(rows.filter((r) => r.mode === 1)),
    2: distinctPerStage(rows.filter((r) => r.mode === 2)),
  } as Record<0 | 1 | 2, StageCounts>;

  return { perStage, conversion, byMode };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:lib -- lib/funnelReport.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/funnelReport.ts lib/funnelReport.test.ts
git commit -m "feat(funnel): pure computeFunnel — conversion + per-mode breakdown (C1)"
```

---

## Task 6: Admin report route (`app/api/admin/funnel/route.ts`)

**Files:**
- Create: `app/api/admin/funnel/route.ts`
- Test: `app/api/admin/funnel/route.test.ts`

Auth mirrors `app/api/refund/route.ts:30-37` (`x-admin-key` === `REFUND_ADMIN_KEY`).

- [ ] **Step 1: Write the failing test**

```ts
// app/api/admin/funnel/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSupabaseServer = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));

const { GET } = await import('./route');

function makeSupabase(rows: Array<Record<string, unknown>>) {
  const calls: { gte?: string } = {};
  const client = {
    from() {
      return {
        select: () => ({
          gte: (_col: string, val: string) => {
            calls.gte = val;
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      };
    },
  };
  return { client, calls };
}

function getReq(key?: string): Request {
  return new Request('http://localhost/api/admin/funnel?days=7', {
    headers: key ? { 'x-admin-key': key } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('REFUND_ADMIN_KEY', 'secret');
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/admin/funnel', () => {
  it('401s without the admin key', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it('401s with the wrong admin key', async () => {
    const res = await GET(getReq('nope'));
    expect(res.status).toBe(401);
  });

  it('503s when the admin key is not configured', async () => {
    vi.stubEnv('REFUND_ADMIN_KEY', '');
    const res = await GET(getReq('secret'));
    expect(res.status).toBe(503);
  });

  it('returns the computed funnel for the window', async () => {
    const { client } = makeSupabase([
      { session_id: 'a', stage: 'connect', mode: null },
      { session_id: 'a', stage: 'mode_select', mode: 1 },
    ]);
    getSupabaseServer.mockReturnValue(client);

    const res = await GET(getReq('secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.perStage.connect).toBe(1);
    expect(json.perStage.mode_select).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:lib -- app/api/admin/funnel/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Write minimal implementation**

```ts
// app/api/admin/funnel/route.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:lib -- app/api/admin/funnel/route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/funnel/route.ts app/api/admin/funnel/route.test.ts
git commit -m "feat(funnel): admin-only funnel report endpoint (C1)"
```

---

## Task 7: Wire `track()` into HomeClient transitions

**Files:**
- Modify: `app/HomeClient.tsx`

No new unit test (UI wiring); verified by `pnpm lint` + `pnpm build` typecheck.
Six call sites. `chainId` and `address` are already in scope (lines 96, and
`chainId` from `useChainId`). Compute the active numeric mode where needed via
the existing `submitted ? 0 : hotTake ? 1 : 2` idiom.

- [ ] **Step 1: Import the emitter**

Add near the other `@/lib` imports:

```ts
import { track } from '@/lib/funnel';
```

- [ ] **Step 2: `connect` — fire on the false→true connection transition**

There is already an effect tracking `isConnected` via `prevConnected` (around
lines 124-140). Add the emit inside that effect, on the rising edge:

```ts
    if (!prevConnected.current && isConnected) {
      track('connect', { chainId, wallet: address ?? undefined });
    }
```

Place this immediately before `prevConnected.current = isConnected;` so it sees
the previous value. (`chainId` is from `useChainId()`, `address` from
`useAccount()` — both already in scope.)

- [ ] **Step 3: `mode_select` — in ModePicker `onSelect` (around lines 346-350)**

```tsx
      <ModePicker
        onSelect={(m) => {
          const mode = m === 'educational' ? 0 : m === 'hot-take' ? 1 : 2;
          track('mode_select', { mode, chainId, wallet: address ?? undefined });
          if (m === 'educational') setScreen('educational');
          if (m === 'hot-take') setScreen('hot-take');
          if (m === 'token-analysis') setScreen('token-analysis');
        }}
      />
```

- [ ] **Step 4: `submit` — at the top of `beginFlow` (around line 297-298)**

`beginFlow` is the single chokepoint with the numeric `mode` in scope. Add right
after the `if (!address) return;` guard:

```ts
      if (!address) return;
      track('submit', { mode, chainId, wallet: address });
```

- [ ] **Step 5: `preview` — where the preview is shown (around line 325-326)**

```ts
      if (preview) {
        setPreviewData(preview);
        track('preview', { mode, chainId, wallet: address });
        setScreen('preview-locked');
      } else {
```

- [ ] **Step 6: `pay` — effect on payment confirmed (`status === 'success'`)**

Add a new effect near the other status effects. `status` is from
`usePayForThread`; the active mode uses the existing idiom:

```ts
  useEffect(() => {
    if (status === 'success') {
      const mode: 0 | 1 | 2 = submitted ? 0 : hotTake ? 1 : 2;
      track('pay', { mode, chainId, wallet: address ?? undefined });
    }
  }, [status, submitted, hotTake, chainId, address]);
```

- [ ] **Step 7: `share` — in the existing completion effect (around lines 239-243)**

The effect that sets `draftTweets` on successful completion is the
share-screen-reached signal. Fire there, guarded by the same `draftTweets ===
null` edge so it emits once:

```ts
    if (gen.isDone && gen.tweets && !gen.fatal) {
      if (draftTweets === null) {
        const mode: 0 | 1 | 2 = submitted ? 0 : hotTake ? 1 : 2;
        track('share', { mode, chainId, wallet: address ?? undefined });
        setDraftTweets(gen.tweets);
      }
    }
```

Add `submitted, hotTake, chainId, address` to that effect's dependency array.

- [ ] **Step 8: Verify lint + typecheck**

Run: `pnpm lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add app/HomeClient.tsx
git commit -m "feat(funnel): emit funnel events at the six flow transitions (C1)"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run the whole lib/app suite**

Run: `pnpm test:lib`
Expected: PASS — all prior tests plus the new funnel suites
(`funnelTypes`, `funnel`, `public/funnel/route`, `funnelReport`,
`admin/funnel/route`).

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Production build**

Run: `pnpm build`
Expected: build succeeds; the two new routes appear in the route manifest.

- [ ] **Step 4: Final commit if anything changed**

```bash
git add -A
git commit -m "test(funnel): full suite green for C1" || echo "nothing to commit"
```

---

## Notes for the implementer

- **Migration is not auto-applied.** `0006_funnel_events.sql` must be run against
  Supabase (`pnpm`/dashboard) before the ingest route can write in a real
  environment. Tests mock Supabase, so they pass regardless.
- **No PII invariant:** the ingest route stores only `session_id`, `stage`,
  `mode`, `chain_id`, `wallet_address`. It never reads or stores the client IP
  (the IP is used transiently as the rate-limit key only). Don't add fields.
- **Fail-open vs fail-closed:** the ingest endpoint fails *closed* (drops events)
  but always returns 202 — analytics loss is acceptable, breaking the user flow
  is not. This differs from the generate route's fail-open replay guard; don't
  copy that philosophy here.
- **Retention** (pruning rows > 90 days) is a deliberate follow-up, not in this
  plan.
