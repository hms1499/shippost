# Measurable share loop — source attribution

**Date:** 2026-07-24
**Status:** Approved design (pre-implementation)
**Approach:** A (source on every funnel event + `visit` stage). B and C rejected/deferred — see below.

## Problem

The X share loop is unmeasurable. `buildShareText` appends a bare app URL
(`https://shippost-kappa.vercel.app`) with no source tag, and nothing on the
landing side reads an inbound param. The funnel (`funnel_events`) records
behaviour (connect → … → pay) but never acquisition source, and its earliest
stage (`connect`) requires MiniPay — so a share-clicker who lands in a normal
browser and bounces is invisible.

Result: we cannot answer "how many app visits / payments came from an X share?"
— exactly the number Proof of Ship needs to prove the loop works.

## Goal & success criteria

- Tag outbound share links with a source (`?ref=x`).
- Capture that source on landing and attach it to **every** subsequent funnel
  event, so a query can join source → conversion.
- Record a top-of-funnel `visit` event so browser-only share-clickers (never
  connect MiniPay) are counted.
- **Success:** given the data, one can compute "sessions with `source='x'` that
  reached `pay`" — the share→revenue number — from `funnel_events` alone.

Non-goal for this spec: the reporting UI / per-source breakdown (deferred to
phase 2, approach C). This spec only guarantees the data is captured correctly;
the existing admin report keeps working untouched.

## Rejected / deferred alternatives

- **B — outbound UTM only, measure via external analytics.** Rejected: external
  tools can't see the MiniPay webview funnel and can't join to the on-app `pay`
  event, so it can't prove share→revenue. The app already owns a funnel.
- **C — A plus a per-source dashboard on `/stats`.** Deferred to phase 2: build
  it once real source data exists.

## Design

### 1. Data model — `supabase/migrations/0011_funnel_source_and_visit.sql`

Additive migration, mirroring the `0007` stage-widening pattern:

```sql
-- Widen the stage check to include the new top-of-funnel 'visit' event.
alter table public.funnel_events
  drop constraint if exists funnel_events_stage_check;
alter table public.funnel_events
  add constraint funnel_events_stage_check check (stage in
    ('visit','connect','mode_select','submit','preview','pay','share','receipt_copied'));

-- Acquisition source, first-touch, nullable (most events have none). Kept as a
-- free text column (validated in the app to a small whitelist) so adding a new
-- source later needs no migration.
alter table public.funnel_events
  add column if not exists source text;

create index if not exists funnel_events_source_idx on public.funnel_events (source);
```

No RLS change — service-role only, consistent with the table's existing policy.

### 2. Wire vocabulary — `lib/funnelTypes.ts` (isomorphic; no client/server imports)

- `FUNNEL_STAGES`: prepend `'visit'`.
- Add the source whitelist + guard:
  ```ts
  export const FUNNEL_SOURCES = ['x'] as const; // append-only; 'x' = X share link
  export type FunnelSource = (typeof FUNNEL_SOURCES)[number];
  export function isFunnelSource(v: unknown): v is FunnelSource {
    return typeof v === 'string' && (FUNNEL_SOURCES as readonly string[]).includes(v);
  }
  ```
- `FunnelEventInput`: add `source?: FunnelSource | null`.

### 3. Outbound tagging — `lib/shareText.ts`

- Add a source constant `X_SHARE_REF: FunnelSource = 'x'`.
- `shareAppUrl(source?: FunnelSource)`: when `source` is given, append `?ref=<source>`
  to the base URL (base currently has no query string, so a plain `?ref=` is safe).
- `buildShareText(firstTweet, { attribution: true })` uses `shareAppUrl(X_SHARE_REF)`.
- Length accounting unchanged: X wraps any URL to a fixed 23-char t.co link, and
  the existing `.length` over-count only ever drops attribution (never truncates
  user text), so `?ref=x` is free in the tweet budget.
- Visible link becomes `https://shippost-kappa.vercel.app/?ref=x`.

### 4. Inbound capture — `lib/funnel.ts`

- `const SOURCE_KEY = 'coinop.funnel.source';`
- `export function captureSource(): FunnelSource | null` —
  - if a source is already stored in sessionStorage, return it (**first-touch wins**);
  - else read `?ref` from `window.location.search`, validate via `isFunnelSource`;
  - if valid, persist to sessionStorage and return it; else return null.
  - All wrapped in try/catch (blocked storage → return null, never throw), matching `getSessionId`.
- `buildPayload` gains an optional `source` and includes it when present.
- `track()` reads the stored source (via a small `getStoredSource()` that reads
  sessionStorage without parsing the URL) and passes it into `buildPayload`, so
  **every** event after capture carries the source.

### 5. Landing event — `app/HomeClient.tsx`

- In the existing mount `useEffect` (the one that sets `mounted`), after mount:
  - call `captureSource()`;
  - fire `track('visit', { chainId })` **exactly once per session**, guarded by a
    sessionStorage flag `coinop.funnel.visited` so remounts / client navigations
    don't double-count.
- `track('visit')` picks up the just-captured source via the stored-source path in `track`.
- This records the top of the funnel even for non-MiniPay, browser-only visitors.

### 6. Ingest — `app/api/public/funnel/route.ts`

- `parse()`:
  - `stage:'visit'` is accepted automatically once `isFunnelStage` includes it;
  - validate `source`: `isFunnelSource(b.source) ? b.source : null` (invalid/absent → null);
  - add `source` to the returned row.
- Everything else unchanged: always 202, per-IP rate limited, drop-on-invalid, DB-down tolerant.

### 7. Reporting — out of scope (phase 2 / approach C)

The admin report (`app/api/admin/funnel`) selects only
`session_id,stage,mode,wallet_address` and `computeFunnel` counts only the
stages it knows, so a new `visit` row and `source` column are inert to it. No
change required for this spec; phase 2 adds the per-source breakdown to `/stats`.

## What this measures

- `visit` rows with `source='x'` = share-link clicks that reached the app.
- Because `source` rides every later event, "sessions with `source='x'` that also
  have a `pay` row" = the share→revenue number.

## Limits (accepted)

- sessionStorage is per-tab: a user who clicks a share link in a normal browser
  and then separately opens MiniPay will not carry the source across contexts —
  an inherent webview-wallet attribution gap. Documented, not solved here.
- Only the `x` source exists now; the whitelist + `?ref` scheme extend cleanly
  (e.g. add `receipt` when image-share ships).

## Testing

- `lib/funnelTypes.test.ts`: `isFunnelSource` accepts `'x'`, rejects others/non-strings;
  `'visit'` is a valid stage.
- `lib/shareText.test.ts`: `buildShareText` includes `?ref=x` when `attribution:true`;
  no `?ref` when `attribution:false`; the length fallback still drops attribution gracefully.
- `lib/funnel.test.ts`: `captureSource` reads `?ref=x`, whitelists junk to null,
  first-touch wins over a later different `?ref`; `buildPayload`/`track` include the
  stored source. (jsdom + sessionStorage/location stubs, matching existing funnel tests.)
- `app/api/public/funnel/route.test.ts`: `parse` accepts `visit` + valid `source`,
  nulls an invalid `source`, still 202s on junk.

## Files touched

- `supabase/migrations/0011_funnel_source_and_visit.sql` (new)
- `lib/funnelTypes.ts`
- `lib/shareText.ts`
- `lib/funnel.ts`
- `app/HomeClient.tsx`
- `app/api/public/funnel/route.ts`
- Tests above (new/updated)

## Ops

- Run migration `0011` on Supabase (same as prior migrations). No new env var —
  `NEXT_PUBLIC_APP_URL` is already set on prod. The `?ref` param needs no config.
