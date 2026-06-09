# Review follow-ups — backlog for future sessions

Date: 2026-06-08
Owner: solo (trunk-based on `main`)

Prioritized backlog of what's left from the senior UI/UX + flow review. Each
item lists the problem, evidence (`file:line`), the recommended approach, and a
rough effort (XS/S/M/L). When picking one up: brainstorm → spec → TDD, same as
this session.

> **Status (2026-06-09):** B1, A2, A1, B2, B3, B4 all shipped to `main`. **C1
> shipped** — spec `docs/superpowers/specs/2026-06-09-funnel-instrumentation-design.md`,
> plan `docs/superpowers/plans/2026-06-09-funnel-instrumentation.md`, implemented
> across 8 commits (`4b908b4`…`6fa7c8f`). **Only C2 (i18n) remains** — deliberately
> deferred until the C1 funnel produces drop-off data to guide it. NOTE: the
> `0006_funnel_events.sql` migration must be applied to Supabase before the
> ingest route can write in a live environment.

## Done this session (context)
- Slow-state advisory model — fixed UI dead-end + refund-on-delivered (#1/#2).
- Per-IP limit on free preview (#3).
- Honest preview copy — "free sample", not "unlock" (#4).
- Hot Take reads pasted URLs via url-preview metadata (#5).
- 3-tier type system (IM Fell / EB Garamond / mono), italic discipline.
- Landing specimen; thread editor reorder/delete; codex dark theme.

---

## A. Correctness / money

### A1 — Enforce `ctx.signal` before every x402 settle (review #7)
- **Problem:** after the 150s pipeline deadline fires, the orphaned pipeline can
  keep running and still settle (spend) for a run already declared
  `fatal`/refundable → double-spend window (paid refund + x402 spent).
- **Evidence:** `app/api/generate/stream/route.ts:33-53` (deadline + `ac.abort()`),
  `lib/pipeline/types.ts:26-29` (`ctx.signal` contract: steps MUST check it
  before settle). The signal is already plumbed into `baseCtx`; the gap is
  whether every step actually honors it.
- **Approach:** audit `serperStep`, `coingeckoStep`, `groqStep`, `factCheckStep`
  — assert each throws if `ctx.signal.aborted` *immediately before* its settle
  call, and pass the signal into the x402 call where possible. Add a unit test
  per step: aborted signal ⇒ no settle.
- **Effort:** M. **Severity:** medium (money, low frequency). Mostly an audit +
  guard rather than new architecture, since the signal already exists.

### A2 — Second replay guard for the Supabase-outage window (review #6)
- **Problem:** the replay guard is the unique `(chain_id, onchain_thread_id)`
  index. When Supabase is down, `getSupabaseSafe()` returns null and the guard
  is skipped (degraded mode) → the same `payTxHash` can be replayed to generate
  (and spend x402) multiple times for one payment.
- **Evidence:** `app/api/generate/stream/route.ts:110-142`.
- **Approach:** add a cheap Redis (Upstash, already present) `SET NX` on
  `payTxHash` before any spend, TTL ~1h. If the DB insert is skipped, the Redis
  key still rejects a replay. Fail-open if Redis is also down (don't take
  generation fully offline — same philosophy as the existing rate limiter).
- **Effort:** S. **Severity:** low-medium (needs a DB outage to matter).

---

## B. Polish (batchable)

### B1 — Mobile keyboard can cover the Generate CTA  ← start here
- **Problem:** on the input screens the primary CTA sits at the bottom; when the
  MiniPay webview keyboard opens it can hide the button.
- **Evidence:** `components/EducationalInput.tsx`, `HotTakeInput.tsx`,
  `TokenAnalysisInput.tsx` (submit block at the end).
- **Approach:** sticky CTA within the safe-area, or `scrollIntoView` on focus.
  Verify in a real mobile viewport.
- **Effort:** S. **Severity:** real on the actual (mobile-only) product.

### B2 — Remove dead `ErrorSurface` `insufficient` kind
- **Problem:** the `insufficient` kind is never rendered (inputs handle the
  insufficient-balance case inline); `window.open('https://minipay.to')` is also
  unverified in the webview.
- **Evidence:** `components/ErrorSurface.tsx:29-33,79-80`; no caller in
  `HomeClient.tsx`.
- **Approach:** delete the kind + COPY entry + the `window.open` branch.
- **Effort:** XS. Fold into any nearby commit.

### B3 — ModePicker numerals vs internal mode ids
- **Problem:** display numerals I/II/III (Hot Take/Educational/Token Analysis)
  don't match internal mode ids (educational=0, hot-take=1, token-analysis=2).
  No user-facing bug; dev-confusion only.
- **Evidence:** `components/ModePicker.tsx` order vs `lib/pipeline/modes/*` ids.
- **Approach:** a clarifying comment that display order ≠ mode id. Don't renumber
  modes (ids are append-only, emitted on-chain).
- **Effort:** XS.

### B4 — "I posted it →" is self-reported
- **Problem:** the post-share confirmation is user-asserted, so analytics
  share-rate is unreliable.
- **Evidence:** `app/HomeClient.tsx` (`setScreen('post-share')`), `ShareToX.tsx`.
- **Approach:** accept it but label the metric as self-reported in analytics, or
  derive a softer signal (e.g. "opened X composer"). Low priority.
- **Effort:** S.

---

## C. Strategic (each needs its own spec)

### C1 — Funnel instrumentation (do before C2)
- **Why:** there's no drop-off data for connect → mode → submit → preview → pay
  → share. UX decisions (incl. C2) are guesses without it; pay-per-use makes the
  pay step the one to watch.
- **Approach:** emit funnel events to the existing `/api/public/analytics`; a
  dashboard/query for stage conversion + which mode converts best.
- **Effort:** M.

### C2 — i18n / localization
- **Why:** MiniPay's big markets (Africa/LatAm) are ESL; the UI is archaic
  English (highest-friction register). Likely the biggest conversion lever.
- **Approach:** extract strings; keep the core flow in plain English first; add a
  locale layer. Large — its own spec.
- **Effort:** L.

---

## Suggested order
`push` → ~~**B1**~~ → ~~**A2**~~ → ~~**A1**~~ → batch ~~**B2/B3/B4**~~ →
~~**C1**~~ → **C2** (next). Rationale: cheap correctness/polish first, instrument
(C1) before investing in the big UX bet (C2) so data guides it. Everything
through C1 is done; C2 is the only remaining item and needs its own spec.
