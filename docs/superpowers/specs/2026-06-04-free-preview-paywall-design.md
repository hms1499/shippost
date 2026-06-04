# Free preview ("taste") paywall — Batch B design

**Date:** 2026-06-04
**Status:** approved (design), pending spec review

Reduce the "pay before you see any quality" friction: let a user see the first
tweet of their thread for free, then pay $0.05 to unlock the full thread. The
preview is a *taste* — paying regenerates the thread fresh; the previewed tweet
need not be byte-identical to the paid result.

## Core principle (drain-safety invariant)

The free preview **never touches AgentWallet / `settleX402Call` and never writes
a `threads` row.** It runs the mode's external API steps (Groq; for Mode B also
Serper + CoinGecko) with our backend keys, returns **only the first tweet + a
count of locked tweets**, and discards the rest. On-chain spend stays gated
behind payment exactly as today; the existing paid flow is unchanged.

Therefore the only new exposure is *free third-party API usage* (Serper's
2,500/mo free tier is the scarce resource), which is bounded by rate limiting
(§3). On-chain drain is impossible by construction — there is no settle on this
path.

## Scope

**In:**
- A settle-free preview generation path + `POST /api/preview` endpoint.
- Per-wallet + global rate limiting for previews, fail-closed.
- A `preview-locked` screen in the client flow with graceful fallback to
  pay-first.
- Both modes: Mode A preview = Groq; Mode B preview = grounded
  (Serper + CoinGecko + Groq), minus settle.

**Out:**
- Any change to the paid `/api/generate/stream` flow or its invariants.
- Caching the previewed thread to "unlock" the exact same content (the rejected
  "Unlock" architecture — paying regenerates fresh).
- Consistency guarantee between previewed tweet 1 and paid tweet 1.

## 1. Preview generation path (settle-free)

Factor the external-call portion of each step out of the settle/emit wrapper so
it can run without spending:

- A `runPreview(mode, input)` function returns the draft thread (array of
  tweets) by calling the same underlying functions the paid runners use
  (`generateDraft` for Groq; the Serper and CoinGecko fetchers for Mode B) —
  **without** `settleX402Call`, **without** emitting `step_output`, **without**
  any Supabase write.
- The paid runners (`runModeA` / `runModeB`) keep settle + delivery exactly as
  today; they are not modified beyond extracting the shared external-call
  helpers they already wrap.
- `runPreview` returns `{ tweets }`; the endpoint slices `tweets[0]` and
  `tweets.length`.

## 2. `POST /api/preview`

- **Input:** `{ mode: 0 | 1, walletAddress, topic?, audience?, eventDescription?,
  angle? }` — the same generation inputs as the paid flow, **no payment fields**.
- **Validates** inputs the same way the paid route validates them (audience ∈
  {beginner,intermediate,advanced}; angle ∈ {bullish,bearish,skeptical}).
- **Flow:** rate-limit check (§3) → `runPreview(mode, input)` → respond
  `{ firstTweet: string, totalTweets: number }`.
- **Never:** calls `settleX402Call`, references `AgentWallet`, or inserts into
  `threads`. Tweets 2..N are never serialized into the response.
- **Errors (pinned):** generation failure → HTTP `502` `{ error }`;
  rate-limited / cap-hit / Redis-down → HTTP `200` `{ available: false }`. The
  client treats *both* as "fall back to pay-first", but the `200 { available:
  false }` shape lets it distinguish a deliberate unavailable from a real
  failure without try/catch on status codes.
- **Runtime:** `nodejs`; bounded by a short internal deadline (preview is a
  single quick generation — propose 30s) so a hung preview never hangs the UI.

## 3. Abuse control (rate limiting)

Extend `lib/rateLimit.ts` with a `free-preview` limiter:

- **Per-wallet:** 3 previews / 10 min (keyed by `walletAddress`).
- **Global daily circuit-breaker:** `PREVIEW_DAILY_CAP` (env, default **500/day**)
  to protect the Serper free tier.
- **Fail-closed:** if Upstash/Redis is unavailable (cannot enforce the global
  cap), `/api/preview` returns `available: false` and the UI falls back to
  pay-first. This is deliberately stricter than the existing `url-preview`
  limiter (which fails open) because the preview path consumes shared
  third-party quota.

## 4. Frontend flow (`HomeClient` + new screen)

New screen `preview-locked` between input-submit and payment:

```
mode → input → [submit] → preview-locked → [Unlock $0.05] → payForThread → generating → preview(full) → post-share
```

- On input submit, the client calls `POST /api/preview`. On success it shows the
  `preview-locked` screen: **tweet 1 in full** + the remaining `totalTweets - 1`
  tweets as **blurred placeholder cards** with a primary CTA "Unlock full thread
  · $0.05".
- "Unlock" runs the **existing** `usePayForThread` → `/api/generate/stream`
  path unchanged.
- **Graceful fallback:** preview error, rate-limited, `available: false`, or
  Redis-down → skip straight to the current pay-first flow with a one-line
  "Preview unavailable — pay to generate". **Paying is never blocked by a preview
  failure.**
- A bounded "regenerate preview" action reuses the same rate limit.
- Reuse `ThreadPreview` card styling for the blurred locked rows.

## 5. Testing

- **Invariant test (highest priority):** the `runPreview` path / `/api/preview`
  never invokes `settleX402Call` or AgentWallet and writes no `threads` row
  (assert via spies/mocks).
- **Slice test:** the response contains only `firstTweet` + `totalTweets`;
  tweets 2..N are never serialized.
- **Rate-limit tests:** per-wallet exhaustion → unavailable; global cap hit →
  unavailable; Redis-down → fail-closed (unavailable, not open).
- **Mode coverage:** Mode A preview returns a Groq tweet 1; Mode B preview runs
  the grounded path and returns a representative tweet 1.
- **Fallback test:** when `/api/preview` reports unavailable, the client still
  reaches the pay flow.

## Out-of-scope guardrails (don't regress)

- The preview path must remain settle-free and write-free forever; the invariant
  test guards this.
- Do not move or weaken any `/api/generate/stream` invariant from
  `.claude/docs/generate-flow.md`.
- Preview must not return more than the first tweet.

## Open parameters (tune at review)

- Per-wallet limit (default 3/10min), global cap (default 500/day), preview
  deadline (default 30s). All env- or constant-tunable; changing them does not
  affect the architecture.
