# C1 — Funnel instrumentation — design

Date: 2026-06-09
Owner: solo (trunk-based on `main`)
Backlog item: C1 (see `docs/superpowers/plans/2026-06-08-review-followups-backlog.md`)

## Problem

There is no drop-off data for the core flow
`connect → mode → submit → preview → pay → share`. UX decisions (including the
C2 i18n bet) are guesses without it; because the product is pay-per-use, the
**pay** step is the one to watch. We want stage-by-stage conversion and which
mode (Hot Take / Educational / Token Analysis) converts best — without storing
PII.

## Decisions (locked in brainstorming)

- **Funnel identity:** an anonymous, per-session UUID generated client-side.
  No PII. Lets us de-duplicate and compute true per-session drop-off.
- **Storage:** a new `funnel_events` table (the `threads` row only exists after
  payment, so the pre-pay stages can't live there).
- **Reporting surface:** an admin-only endpoint. Conversion/drop-off is
  sensitive; the public `/stats` page stays as-is (threads, volume, agent spend).

## Event taxonomy

Six stages, matching the flow exactly:

| stage         | fired when                                            | mode known? |
|---------------|-------------------------------------------------------|-------------|
| `connect`     | wallet connected (MiniPay injected provider)          | no          |
| `mode_select` | user picks a mode on the ModePicker                   | yes         |
| `submit`      | user submits an input form (begins the paid flow)     | yes         |
| `preview`     | the free preview is shown                             | yes         |
| `pay`         | payment verified on-chain, generation starts          | yes         |
| `share`       | user reaches the share/post-share screen              | yes         |

No separate `generate_done` / `generate_fail` stages — completion is already
recorded in `threads.status`; the funnel's job is the click-path up to share.

Each event carries:

- `session_id` — random UUID, one per browser session (`sessionStorage`).
- `stage` — one of the six above.
- `mode` — `0 | 1 | 2` (educational / hot-take / token-analysis on-chain ids)
  or `null` for `connect` (before a mode is chosen).
- `chain_id` — number or null.
- `wallet_address` — lowercased, **nullable**, attached only from `connect`
  onward. Pseudonymous (not PII) and already persisted in `threads`, so it lets
  us join the funnel to real conversions later.
- `created_at` — server timestamp.

**No IP, no free-text, no other PII is stored.** The client never sends a field
outside this set, and the ingest route drops anything it doesn't recognise.

## Components

### 1. Client emit — `lib/funnel.ts`

```
track(stage: FunnelStage, opts?: { mode?: number; chainId?: number; wallet?: string }): void
```

- Resolves/creates the session UUID in `sessionStorage` (`shippost.funnel.sid`).
- Sends via `navigator.sendBeacon('/api/public/funnel', blob)` so the event
  survives navigation/unload and never blocks the UI. Falls back to
  `fetch(url, { method: 'POST', keepalive: true, ... })` when `sendBeacon` is
  unavailable.
- Fire-and-forget: any error is swallowed. Analytics must never break the flow.
- SSR/`typeof window === 'undefined'` guard → no-op.

Call sites in `app/HomeClient.tsx` at the six transitions above.

Testable seam: a pure `pickTransport()` / `buildPayload()` so the
sendBeacon-vs-fetch choice and the payload shape are unit-tested without a DOM.

### 2. Ingest — `POST /api/public/funnel`

- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`.
- Parse JSON; **strict validation**:
  - `session_id` matches a UUID regex,
  - `stage` ∈ the six-value enum,
  - `mode` ∈ `{0,1,2}` or absent/null,
  - `chain_id` a finite number or absent,
  - `wallet_address` matches `0x[0-9a-fA-F]{40}` or absent.
  Any unknown field is ignored; a malformed body is dropped.
- Per-IP rate limit via `checkRateLimit(ip, 'funnel-ingest')` — a new limiter,
  ~60 events / 60s. **Fails closed silently**: over the limit (or invalid body)
  still returns `202` and simply doesn't insert. Losing analytics events is
  acceptable; breaking the client is not.
- On success: one row into `funnel_events` (service-role client). If Supabase is
  unavailable (`getSupabaseSafe()` → null) the event is dropped, still `202`.
- IP is used only transiently for the rate-limit key; never stored.

### 3. Schema — `supabase/migrations/0006_funnel_events.sql`

```sql
create table if not exists funnel_events (
  id             bigserial primary key,
  session_id     text        not null,
  stage          text        not null,
  mode           smallint,
  chain_id       integer,
  wallet_address text,
  created_at     timestamptz not null default now()
);
create index if not exists funnel_events_stage_idx      on funnel_events (stage);
create index if not exists funnel_events_session_idx     on funnel_events (session_id);
create index if not exists funnel_events_created_at_idx  on funnel_events (created_at);
```

Service-role only (no anon RLS policy), matching the `threads` pattern.

**Retention:** keep raw rows for now. Pruning rows older than 90 days is a
documented follow-up (a `scripts/` ops job or a scheduled task), not built here
— YAGNI until table growth is a real problem.

### 4. Reporting — `GET /api/admin/funnel?days=7`

- Auth: header `x-admin-key` must equal `process.env.REFUND_ADMIN_KEY`
  (reuses the existing admin-key pattern; 401 otherwise). No key configured →
  401 (fail closed).
- `days` query param (default 7, clamped to a sane max e.g. 90) bounds the
  window via `created_at`.
- Reads the window's rows and computes, in a **pure** `computeFunnel(rows)`:
  - distinct `session_id` count per stage,
  - stage→stage conversion % along the canonical order,
  - per-mode breakdown from `mode_select` onward (sessions per mode per stage)
    → "which mode converts best".
- Returns JSON; no UI page in this iteration (admin reads JSON, same spirit as
  `pnpm refund:list`). A dashboard can come later.

## Data flow

```
HomeClient transition
  → track(stage)                         (lib/funnel.ts, sendBeacon)
  → POST /api/public/funnel              (validate + rate-limit + insert)
  → funnel_events row

Admin
  → GET /api/admin/funnel?days=7         (x-admin-key)
  → read window → computeFunnel(rows)    (pure)
  → { perStage, conversion, byMode }
```

## Error handling

- Client: all emit errors swallowed; SSR no-op; missing `sessionStorage` → skip.
- Ingest: invalid/over-limit/DB-down → `202`, no insert (silent drop). Never 5xx
  to the client over analytics.
- Admin: missing/wrong key → 401; Supabase error → 500 with a generic message
  (matches the existing analytics route).

## Testing (TDD)

- `lib/funnel.ts`: `buildPayload()` shape; `pickTransport()` prefers sendBeacon,
  falls back to fetch; SSR/no-window → no-op.
- `computeFunnel(rows)`: distinct-session counting, conversion math (incl. a
  stage with zero upstream → no divide-by-zero), per-mode breakdown, empty
  input.
- Ingest validation: accepts a well-formed body; rejects bad UUID / unknown
  stage / out-of-range mode / bad wallet; over-limit → no insert, 202.
- Admin auth: 401 without/with wrong key.

## Out of scope

- A visual dashboard UI (JSON only this iteration).
- Retention/pruning job (documented follow-up).
- Joining funnel → `threads` conversion (the nullable `wallet_address` enables
  it later; not computed here).
- C2 (i18n) — a separate spec, informed by the data this produces.
