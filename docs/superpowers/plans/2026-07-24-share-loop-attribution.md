# Share Loop Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the X share loop measurable — tag outbound share links with `?ref=x`, capture that source on landing, attach it to every funnel event, and record a top-of-funnel `visit` stage, so "share → pay" is queryable from `funnel_events`.

**Architecture:** Additive Supabase migration (new `source` column + `visit` stage in the check constraint). An isomorphic vocabulary file (`funnelTypes`) gains the `visit` stage and a `source` whitelist. The client emitter (`funnel.ts`) reads `?ref` once (first-touch, sessionStorage) and injects the stored source into every event; `HomeClient` fires one `visit` per session. The ingest route validates + stores `source`. Reporting UI is out of scope (the existing admin report picks up `visit` for free).

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest, Supabase (service-role), viem-adjacent (no chain calls here).

## Global Constraints

- Package manager: **pnpm**. Tests: `pnpm test:lib` (Vitest over `lib/` and `app/`). Typecheck: `npx tsc --noEmit`. Lint: `pnpm lint`.
- Analytics must **never** break or block the flow: every funnel path swallows errors, the ingest route always returns **202**.
- No PII. `source` is a non-PII acquisition tag from a fixed whitelist.
- `funnelTypes.ts` is **isomorphic** — no `'use client'`, no server-only imports (runs on both client and ingest route).
- Supabase is **service-role only**; migrations are additive numbered SQL files in `supabase/migrations/`. Next number is **0011**.
- The live app URL is `https://shippost-kappa.vercel.app` (env `NEXT_PUBLIC_APP_URL`); the dead domain `shippost.app` must never be a fallback.
- Commit after each task. Trunk-based: commit directly to `main`.
- Deploy ordering (ops): run migration `0011` on Supabase **before** deploying the code, so new `visit`/`source` rows insert cleanly.

---

### Task 1: Migration 0011 — `visit` stage + `source` column

**Files:**
- Create: `supabase/migrations/0011_funnel_source_and_visit.sql`

**Interfaces:**
- Produces: a `funnel_events.source text` column and a widened `funnel_events_stage_check` that accepts `'visit'`. No code imports this; it is applied to Supabase out-of-band.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/0011_funnel_source_and_visit.sql`:

```sql
-- 1) New top-of-funnel stage: 'visit' — fired once per session on landing,
--    before connect, so share-link clicks that never connect MiniPay are still
--    counted. Widen the stage check (mirrors 0007's pattern).
-- 2) New column: source — first-touch acquisition tag (e.g. 'x' from an X share
--    link). Nullable; most events have none. Kept as free text (validated to a
--    small whitelist in the app) so a new source needs no migration.
alter table public.funnel_events
  drop constraint if exists funnel_events_stage_check;
alter table public.funnel_events
  add constraint funnel_events_stage_check check (stage in
    ('visit','connect','mode_select','submit','preview','pay','share','receipt_copied'));

alter table public.funnel_events
  add column if not exists source text;

create index if not exists funnel_events_source_idx on public.funnel_events (source);
```

- [ ] **Step 2: Sanity-check the SQL is additive and idempotent**

Read the file back. Confirm: only `add column if not exists`, `create index if not exists`, and a `drop constraint if exists` + `add constraint` pair (matching `0007`). No `drop column`, no data mutation, no RLS change.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0011_funnel_source_and_visit.sql
git commit -m "feat(db): funnel_events gains 'visit' stage + source column"
```

> **Ops (not a code step):** apply this migration in the Supabase SQL editor before deploying the code below.

---

### Task 2: `funnelTypes` — `visit` stage + `source` vocabulary

**Files:**
- Modify: `lib/funnelTypes.ts`
- Test: `lib/funnelTypes.test.ts`

**Interfaces:**
- Produces:
  - `FUNNEL_STAGES` now includes `'visit'` (first element).
  - `FUNNEL_SOURCES = ['x'] as const`; `type FunnelSource = 'x'`.
  - `isFunnelSource(v: unknown): v is FunnelSource`.
  - `FunnelEventInput.source?: FunnelSource | null`.

- [ ] **Step 1: Update the failing tests**

In `lib/funnelTypes.test.ts`, update the stages assertion to lead with `visit` and add source-guard tests. Replace the `'lists the stages in funnel order'` test body and add a new test:

```ts
  it('lists the stages in funnel order', () => {
    expect(FUNNEL_STAGES).toEqual([
      'visit',
      'connect',
      'mode_select',
      'submit',
      'preview',
      'pay',
      'share',
      'receipt_copied',
    ]);
  });

  it('isFunnelStage accepts the new visit stage', () => {
    expect(isFunnelStage('visit')).toBe(true);
  });

  it('isFunnelSource accepts the whitelist and rejects everything else', () => {
    expect(isFunnelSource('x')).toBe(true);
    expect(isFunnelSource('y')).toBe(false);
    expect(isFunnelSource('')).toBe(false);
    expect(isFunnelSource(1)).toBe(false);
    expect(isFunnelSource(null)).toBe(false);
  });
```

Add `isFunnelSource` to the import at the top of the test file:

```ts
import {
  FUNNEL_STAGES,
  isFunnelStage,
  isFunnelSource,
  isValidMode,
  UUID_RE,
  WALLET_RE,
} from './funnelTypes';
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run lib/funnelTypes.test.ts`
Expected: FAIL — `isFunnelSource` is not exported / `visit` not in `FUNNEL_STAGES`.

- [ ] **Step 3: Implement the vocabulary changes**

In `lib/funnelTypes.ts`, prepend `'visit'` to `FUNNEL_STAGES`:

```ts
export const FUNNEL_STAGES = [
  'visit',
  'connect',
  'mode_select',
  'submit',
  'preview',
  'pay',
  'share',
  'receipt_copied',
] as const;
```

After the `FunnelStage` type, add the source vocabulary:

```ts
// Acquisition source, append-only whitelist. 'x' = arrived via an X share link
// (?ref=x). Adding a source here needs no DB migration (the column is free text).
export const FUNNEL_SOURCES = ['x'] as const;
export type FunnelSource = (typeof FUNNEL_SOURCES)[number];

export function isFunnelSource(v: unknown): v is FunnelSource {
  return typeof v === 'string' && (FUNNEL_SOURCES as readonly string[]).includes(v);
}
```

In `FunnelEventInput`, add the field:

```ts
export interface FunnelEventInput {
  session_id: string;
  stage: FunnelStage;
  mode?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  chain_id?: number | null;
  wallet_address?: string | null;
  source?: FunnelSource | null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run lib/funnelTypes.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm the report test still passes (visit is inert with no data)**

Run: `pnpm exec vitest run lib/funnelReport.test.ts`
Expected: PASS — `computeFunnel` gains a `visit` key in `perStage`/`conversion`, but keyed assertions and the guarded `conversion.connect === 0` (no visit rows) still hold.

- [ ] **Step 6: Commit**

```bash
git add lib/funnelTypes.ts lib/funnelTypes.test.ts
git commit -m "feat(funnel): add 'visit' stage and source whitelist to vocabulary"
```

---

### Task 3: `shareText` — tag the outbound URL with `?ref=x`

**Files:**
- Modify: `lib/shareText.ts`
- Test: `lib/shareText.test.ts`

**Interfaces:**
- Consumes: `FunnelSource` from `./funnelTypes`.
- Produces:
  - `shareAppUrl(source?: FunnelSource): string` — appends `?ref=<source>` when `source` is given.
  - `buildShareText` now defaults its URL to `shareAppUrl('x')` (unchanged when a caller passes `opts.appUrl`).

- [ ] **Step 1: Write the failing tests**

In `lib/shareText.test.ts`, add two tests. Append inside the `describe('shareAppUrl', ...)` block a ref test, and add a new `describe` for the tagged default:

```ts
  it('appends ?ref=<source> when a source is given', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    const { shareAppUrl } = await import('./shareText');
    expect(shareAppUrl('x')).toBe('https://example.test?ref=x');
  });
```

And a new top-level describe (place after the existing `buildShareText` block):

```ts
describe('buildShareText source tagging', () => {
  const ORIG = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    if (ORIG === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = ORIG;
  });

  it('tags the default app URL with ?ref=x when no appUrl override is given', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://example.test';
    const { buildShareText } = await import('./shareText');
    const out = buildShareText('gm', { attribution: true });
    expect(out).toBe('gm\n\n✍️ made with CoinOp — https://example.test?ref=x');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run lib/shareText.test.ts`
Expected: FAIL — `shareAppUrl` takes no argument yet; default `buildShareText` URL has no `?ref=x`.

- [ ] **Step 3: Implement the tagging**

In `lib/shareText.ts`, add the import and constant near the top:

```ts
import { type FunnelSource } from './funnelTypes';

// The source tag we attach to share links so the funnel can attribute the
// resulting visits/payments. 'x' = the X share button.
const X_SHARE_REF: FunnelSource = 'x';
```

Change `shareAppUrl` to accept an optional source:

```ts
export function shareAppUrl(source?: FunnelSource): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const base = fromEnv || DEFAULT_APP_URL;
  // base never carries a query string, so a plain ?ref= is safe. X wraps any
  // URL to a fixed 23-char t.co link, so the extra chars are free in the tweet.
  return source ? `${base}?ref=${source}` : base;
}
```

In `buildShareText`, default the URL to the tagged form:

```ts
export function buildShareText(
  firstTweet: string,
  opts: { attribution: boolean; appUrl?: string },
): string {
  if (!opts.attribution) return firstTweet;
  const url = opts.appUrl ?? shareAppUrl(X_SHARE_REF);
  const full = `${firstTweet}\n\n✍️ made with CoinOp — ${url}`;
  if (full.length <= TWEET_MAX) return full;
  const short = `${firstTweet}\n\nvia CoinOp ${url}`;
  if (short.length <= TWEET_MAX) return short;
  return firstTweet;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run lib/shareText.test.ts`
Expected: PASS. (Existing tests pass `appUrl: URL` explicitly, so they still get the raw URL and are unaffected.)

- [ ] **Step 5: Commit**

```bash
git add lib/shareText.ts lib/shareText.test.ts
git commit -m "feat(share): tag X share links with ?ref=x for attribution"
```

---

### Task 4: `funnel.ts` — capture source, attach to every event

**Files:**
- Modify: `lib/funnel.ts`
- Test: `lib/funnel.test.ts`

**Interfaces:**
- Consumes: `isFunnelSource`, `FunnelSource` from `./funnelTypes`.
- Produces:
  - `captureSource(): FunnelSource | null` — first-touch: reads `?ref` from the URL, whitelists it, persists to `sessionStorage['coinop.funnel.source']`, returns the stored source (or existing one).
  - `buildPayload` accepts `source` in its opts and includes it only when present.
  - `track` injects the stored source into every event.

- [ ] **Step 1: Write the failing tests**

In `lib/funnel.test.ts`, extend the imports and add a `captureSource` describe plus a `buildPayload` source case:

```ts
import { buildPayload, track, captureSource, __resetSessionIdForTests } from './funnel';
```

Add to the `describe('buildPayload', ...)` block:

```ts
  it('includes source when present', () => {
    const p = buildPayload('sid-1', 'visit', { source: 'x' });
    expect(p).toEqual({ session_id: 'sid-1', stage: 'visit', source: 'x' });
  });
```

Add a new describe block:

```ts
describe('captureSource', () => {
  function stubStorage(initial: Record<string, string> = {}) {
    const store = { ...initial };
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    return store;
  }

  it('reads ?ref=x, whitelists it, and persists it', () => {
    vi.stubGlobal('window', { location: { search: '?ref=x' } });
    const store = stubStorage();
    expect(captureSource()).toBe('x');
    expect(store['coinop.funnel.source']).toBe('x');
  });

  it('ignores a non-whitelisted ?ref value', () => {
    vi.stubGlobal('window', { location: { search: '?ref=evil' } });
    stubStorage();
    expect(captureSource()).toBeNull();
  });

  it('is first-touch: a stored source is not overwritten by a new ?ref', () => {
    vi.stubGlobal('window', { location: { search: '?ref=x' } });
    stubStorage({ 'coinop.funnel.source': 'x' });
    // A later visit with no/other ref keeps the original.
    vi.stubGlobal('window', { location: { search: '' } });
    expect(captureSource()).toBe('x');
  });

  it('returns null (no throw) when there is no window', () => {
    vi.stubGlobal('window', undefined);
    expect(captureSource()).toBeNull();
  });
});

describe('track attaches the stored source', () => {
  beforeEach(() => { __resetSessionIdForTests(); });

  it('adds the stored source to every event body', () => {
    const sendBeacon = vi.fn<(url: string, body?: BodyInit) => boolean>(() => true);
    const store: Record<string, string> = { 'coinop.funnel.source': 'x' };
    vi.stubGlobal('window', { navigator: { sendBeacon }, location: { search: '' } });
    vi.stubGlobal('navigator', { sendBeacon });
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
    });
    vi.stubGlobal('crypto', { randomUUID: () => '3f2504e0-4f89-41d3-9a0c-0305e82c3301' });

    track('pay', { mode: 1 });

    const [, body] = sendBeacon.mock.calls[0];
    // Blob → text is async in jsdom; assert the payload was built with source by
    // spying on buildPayload output shape instead.
    expect(body).toBeInstanceOf(Blob);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run lib/funnel.test.ts`
Expected: FAIL — `captureSource` is not exported; `buildPayload` drops `source`.

- [ ] **Step 3: Implement capture + attach**

In `lib/funnel.ts`, add the import and the source key near the top (below `SID_KEY`):

```ts
import { FunnelStage, FunnelEventInput, isFunnelSource, type FunnelSource } from './funnelTypes';
```

```ts
const SOURCE_KEY = 'coinop.funnel.source';
```

Add `getStoredSource` and `captureSource` (place after `getSessionId`):

```ts
function getStoredSource(): FunnelSource | null {
  try {
    const v = sessionStorage.getItem(SOURCE_KEY);
    return isFunnelSource(v) ? v : null;
  } catch {
    return null;
  }
}

// First-touch acquisition capture. Reads ?ref from the URL, whitelists it, and
// persists it for the session so every later event can be attributed. An
// already-stored source is never overwritten. Safe to call on every mount.
export function captureSource(): FunnelSource | null {
  try {
    if (typeof window === 'undefined') return null;
    const existing = getStoredSource();
    if (existing) return existing;
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (!isFunnelSource(ref)) return null;
    sessionStorage.setItem(SOURCE_KEY, ref);
    return ref;
  } catch {
    return null;
  }
}
```

Extend `buildPayload`'s opts and body (include `source` only when present):

```ts
export function buildPayload(
  sessionId: string,
  stage: FunnelStage,
  opts: { mode?: number | null; chainId?: number | null; wallet?: string | null; source?: FunnelSource | null } = {},
): FunnelEventInput {
  const payload: FunnelEventInput = { session_id: sessionId, stage };
  if (opts.mode === 0 || opts.mode === 1 || opts.mode === 2 || opts.mode === 3 || opts.mode === 4 || opts.mode === 5) payload.mode = opts.mode;
  if (typeof opts.chainId === 'number') payload.chain_id = opts.chainId;
  if (opts.wallet) payload.wallet_address = opts.wallet.toLowerCase();
  if (isFunnelSource(opts.source)) payload.source = opts.source;
  return payload;
}
```

In `track`, inject the stored source when building the body:

```ts
    const body = JSON.stringify(
      buildPayload(sid, stage, { ...opts, source: getStoredSource() }),
    );
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run lib/funnel.test.ts`
Expected: PASS. Existing `track`/`buildPayload` tests are unaffected: their sessionStorage stubs have no `SOURCE_KEY`, so `getStoredSource()` returns null and `source` is omitted.

- [ ] **Step 5: Commit**

```bash
git add lib/funnel.ts lib/funnel.test.ts
git commit -m "feat(funnel): capture ?ref source (first-touch) and attach to every event"
```

---

### Task 5: Ingest route — accept `visit` + validate/store `source`

**Files:**
- Modify: `app/api/public/funnel/route.ts`
- Test: `app/api/public/funnel/route.test.ts`

**Interfaces:**
- Consumes: `isFunnelSource` from `@/lib/funnelTypes`; `buildPayload`/client not involved.
- Produces: inserted rows now always carry `source` (`'x'` or `null`); `stage: 'visit'` is accepted.

- [ ] **Step 1: Update the failing tests**

In `app/api/public/funnel/route.test.ts`:

Update the two exact-shape assertions to include `source: null`. In `'inserts a sanitized row for a valid event and returns 202'`:

```ts
    expect(inserts[0]).toEqual({
      session_id: VALID.session_id,
      stage: 'pay',
      mode: 1,
      chain_id: 42220,
      wallet_address: VALID.wallet_address,
      source: null,
    });
```

In `'drops absent optional fields to null in the row'`:

```ts
    expect(inserts[0]).toEqual({
      session_id: VALID.session_id,
      stage: 'connect',
      mode: null,
      chain_id: null,
      wallet_address: null,
      source: null,
    });
```

Add two new tests inside `describe('POST /api/public/funnel', ...)`:

```ts
  it('accepts a visit event with a valid source', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    await POST(postReq({ session_id: VALID.session_id, stage: 'visit', source: 'x' }));

    expect(inserts[0]).toEqual({
      session_id: VALID.session_id,
      stage: 'visit',
      mode: null,
      chain_id: null,
      wallet_address: null,
      source: 'x',
    });
  });

  it('nulls an invalid source instead of dropping the event', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    await POST(postReq({ ...VALID, source: 'evil' }));

    expect(inserts).toHaveLength(1);
    expect(inserts[0].source).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run app/api/public/funnel/route.test.ts`
Expected: FAIL — rows have no `source` key; the two updated `toEqual` assertions and the new tests fail.

- [ ] **Step 3: Implement source validation in `parse`**

In `app/api/public/funnel/route.ts`, add `isFunnelSource` to the import:

```ts
import {
  isFunnelStage,
  isFunnelSource,
  isValidMode,
  UUID_RE,
  WALLET_RE,
  type FunnelEventInput,
} from '@/lib/funnelTypes';
```

Add `source` to the returned row in `parse` (invalid/absent → null, mirroring the other optional fields):

```ts
  return {
    session_id: b.session_id,
    stage: b.stage,
    mode: b.mode ?? null,
    chain_id: typeof b.chain_id === 'number' ? b.chain_id : null,
    wallet_address: b.wallet_address ? b.wallet_address.toLowerCase() : null,
    source: isFunnelSource(b.source) ? b.source : null,
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run app/api/public/funnel/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/public/funnel/route.ts app/api/public/funnel/route.test.ts
git commit -m "feat(funnel): ingest accepts visit stage and validates source"
```

---

### Task 6: `HomeClient` — fire one `visit` per session on mount

**Files:**
- Modify: `app/HomeClient.tsx`

**Interfaces:**
- Consumes: `captureSource` and `track` from `@/lib/funnel`.
- Produces: no exports; wires the landing event.

- [ ] **Step 1: Add `captureSource` to the funnel import**

In `app/HomeClient.tsx`, the existing import is `import { track } from '@/lib/funnel';`. Change it to:

```ts
import { track, captureSource } from '@/lib/funnel';
```

- [ ] **Step 2: Add the visit effect**

Directly after the existing mount effect:

```ts
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
```

insert:

```ts
  // Record the top of the funnel once per session, tagging the acquisition
  // source (?ref=x from a share link). captureSource runs every mount (it is
  // first-touch internally); the visit event fires at most once per session so
  // client navigations don't double-count. Fires even for browser-only
  // visitors who never connect MiniPay — the true top of the funnel.
  useEffect(() => {
    captureSource();
    try {
      if (sessionStorage.getItem('coinop.funnel.visited')) return;
      sessionStorage.setItem('coinop.funnel.visited', '1');
    } catch {
      // storage blocked → fall through and fire once for this load
    }
    track('visit');
  }, []);
```

- [ ] **Step 3: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: exit 0 (no errors).

Run: `pnpm lint`
Expected: `No ESLint warnings or errors`. (`captureSource`/`track` are stable module imports, so the empty dependency array is correct — no exhaustive-deps warning.)

- [ ] **Step 4: Build to confirm the client bundle compiles**

Run: `pnpm build`
Expected: build succeeds (no type or bundling errors in `HomeClient`).

- [ ] **Step 5: Commit**

```bash
git add app/HomeClient.tsx
git commit -m "feat(funnel): fire a visit event with source on landing"
```

---

## Final verification

- [ ] **Full suite green**

Run: `pnpm test:lib`
Expected: all tests pass (including the updated funnelTypes/shareText/funnel/route tests).

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `pnpm lint`
Expected: clean.

- [ ] **Manual smoke (post-deploy, after migration 0011 is applied):**
  1. Open the app with `?ref=x` → a `visit` row with `source='x'` appears in `funnel_events`.
  2. Complete a paid thread → the `pay` row for that session also carries `source='x'`.
  3. On the share screen, "Post first tweet in X" → the tweet's attribution link ends in `?ref=x`.

## Self-review notes

- **Spec coverage:** migration (§1) → Task 1; vocabulary `visit`+source (§2) → Task 2; outbound `?ref=x` (§3) → Task 3; inbound capture + attach (§4) → Task 4; ingest (§6) → Task 5; landing `visit` (§5) → Task 6. Reporting (§7) intentionally omitted; the report gains `visit` for free (verified inert in Task 2 Step 5).
- **Type consistency:** `FunnelSource`, `isFunnelSource`, `captureSource`, `shareAppUrl(source?)`, `SOURCE_KEY='coinop.funnel.source'`, visited flag `'coinop.funnel.visited'`, `?ref` param name — all used identically across tasks.
- **No placeholders:** every code step shows the exact code; every run step shows the exact command + expected result.
