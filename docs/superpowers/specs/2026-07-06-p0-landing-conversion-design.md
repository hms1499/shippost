# P0 Landing Conversion — Design

**Date:** 2026-07-06
**Status:** Approved, ready for implementation
**Goal:** Lift cold-visitor conversion on the CoinOp landing (organic users ≈ 0). Three changes: a pre-connect free taste, benefit-first copy, and killing credibility bugs. Aesthetic retheme is *not* the bottleneck and is out of scope.

## Context

- Landing is the pre-connect guest state rendered by `components/LandingHero.tsx` (via `app/HomeClient.tsx`). A wallet-connect gate hides the whole product behind `Connect wallet`.
- A free preview ("first tweet free") already exists (`/api/preview` → `lib/pipeline/runPreview.ts` → `PreviewLocked`), but it is gated behind connect → pick mode → type → generate. `/api/preview` currently **requires** `walletAddress`.
- Critical safety fact: `runPreview` is **settle-free** — it never settles an x402 call, spends from the agent wallet, or persists a row. A source-guard test enforces this. Cost per call is a single Groq draft only. So exposing it to anonymous guests is safe from on-chain drain; the only guard needed is rate limiting.
- Rate limits (`lib/rateLimit.ts`): `free-preview` 3/600s per wallet, `free-preview-ip` 10/600s per IP, `free-preview-global` 500/day. `checkPreviewAllowed(wallet, ip)` runs all three.

## A. Guest free-taste (feature)

**UX:** In `LandingHero`, above the receipt replay, add a single topic input + `Get a free first tweet →`. On submit, call the preview endpoint **without a wallet**, render the first tweet inline, then show `+N tweets locked · Connect wallet to unlock & keep for $0.05`.

**Decisions:**
- **Educational mode (mode 0) only.** It is the only mode needing just one field. Hot Take / Token / Daily Recap keep their pickers behind connect. Cold funnel must be one field.
- **Backend:** make `walletAddress` optional in `/api/preview`. When absent, gate via a new `checkPreviewGuestAllowed(ip)` that runs **IP + global limiters only** (skips per-wallet). `runPreview` is unchanged and already wallet-agnostic. No paid pipeline is touched. Fail-closed on limiter unavailability (matches existing `checkPreviewAllowed`).
- **Fail soft on the client:** any non-success (rate, error, timeout) → silently fall back to just showing `Connect wallet`. A failed preview must never block connecting/paying.
- **Analytics:** track a `guest_preview` event on submit + success (reuse existing `track` / funnel instrumentation).

**Invariant preserved:** guest access adds no new spend path — `runPreview` still never settles or persists. The guest gate only relaxes *identity* (no wallet), not the settle-free guarantee.

## B. Copy — benefit-first, de-jargon

- Keep H1 `One coin in. One thread out.`
- Replace the x402-jargon subhead with a benefit-first line, e.g. *"Type a topic, get a ready-to-post X thread in ~20s. Pay 5¢ only if you keep it."* (final wording at implementation).
- Move `the agent pays AI services per call (x402)` to a quiet trust subline near the receipt (proof layer), not the opening pitch.
- Collapse dual auth: `Connect wallet` stays primary; drop the redundant second "sign in from the corner" mention (top-right Sign in remains).

## C. Credibility fixes

- **`(no topic)` → derived label** in the stats recent-entries row. Use `topic` when present; else per-mode fallback: mode 3 → "Daily Recap", mode 1 → "Hot Take", mode 2 → "Token Analysis", mode 0 → "Untitled thread". Extract a small pure helper `threadLabel({ mode, topic })` so it is unit-testable. Public threads API already returns `mode` + `topic`.
- **Index numeral orphan (guest sees only "01"):** out of scope this pass (02 "My History" appears on connect; the effect is mild). Noted as P2.
- **Blank metric icon:** likely `TerminalPanel` title styling, not a bug. Verify during implementation; fix only if genuinely broken.

## Out of scope

- Visual/aesthetic retheme (already strong).
- Multi-mode guest preview.
- Index numbering rework.

## Testing

- Unit: `checkPreviewGuestAllowed(ip)` — allows within IP+global budget, denies when exceeded, fails closed when limiters unavailable, and does **not** consult the per-wallet limiter.
- Unit: `/api/preview` accepts a no-wallet mode-0 body and returns a first tweet (mocked `runPreview`); still rejects malformed bodies.
- Unit: `threadLabel` returns topic when present and the correct per-mode fallback when not.
- Source-guard: existing settle-free guard over `runPreview` must still pass (guest path adds no settle).
- Manual: guest types a topic on the deployed landing → sees a free first tweet → `Connect wallet` unlock affordance; rate-limit exhaustion falls back cleanly.
