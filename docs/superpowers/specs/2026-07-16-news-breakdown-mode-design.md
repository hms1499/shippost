# News Breakdown Mode — Design

**Date:** 2026-07-16
**Status:** Approved design → ready for implementation plan
**Mode id (on-chain, append-only):** `5` — key `newsReaction`, display label **"News Breakdown"**

## Summary

A new paid generation mode that reacts to **one specific news item** with a
**neutral breakdown thread**: what happened → why it matters → who is affected
→ what to watch next. It fills the highest-frequency content slot for a web3
creator (single-news reaction) that today is only partially served by Hot Take,
which forces an opinionated angle.

It reuses the vetted `runModeB` settle/delivery orchestration via a
`buildPrompt` override — the exact pattern `comparison` (id 4) shipped with —
so it inherits the *settle-gates-delivery* invariant for free and adds **no new
spend path**.

### Decisions locked during brainstorming

| Question | Decision |
|----------|----------|
| Output framing | **Neutral breakdown** (no angle, no side-picking) — the differentiator vs Hot Take |
| Input | **URL or free text**, same as Hot Take — reuse `/api/url-preview` + `UrlPreviewCard` + `composeEvent` |
| Pipeline recipe | **Full Hot Take recipe**: serper → coingecko → groq → factCheck (~$0.003 agent cost) |
| Serper recency | `qdr:w` (past week) — tighter than Hot Take's `qdr:m`; not `qdr:d` (overnight-VN articles can exceed 24h index) |
| Architecture | **Reuse `runModeB(overrides)`** (Approach A; Approach B "new Hot Take angle" rejected — kills per-mode analytics and picker presence; C "dual-search pipeline" rejected — unproven need) |
| Input component | **Separate `NewsBreakdownInput.tsx`** (deliberate copy of `HotTakeInput` minus the angle row) rather than a `variant` prop |
| Picker placement | Display position **II** (right after Hot Take), numeral VI — display order is decoupled from on-chain id by existing `ModePicker` convention |

## Product & UX

- **Label:** "News Breakdown" (not "News Reaction" — *reaction* implies a take
  and blurs the Hot Take boundary). Icon: `Newspaper` (lucide).
- **Blurb:** "A news just dropped — break it down: what happened, why it
  matters, what to watch. No hot take, just clarity." Cost `$0.003`, badge
  `grounded · fact-checked · live data`.
- **Boundary on the picker:** Hot Take = "react with a take"; News Breakdown =
  "explain what happened". Blurbs must keep this contrast explicit.
- **Input screen:** paste-a-link-or-type-a-headline, with the existing OG
  preview card. No angle row.

## Pipeline & prompt

### `lib/pipeline/modes/newsReaction.ts` (new `ModeDef`)

- `validateInput(body)`: require non-empty `eventDescription` (same as Hot
  Take). A stray `angle` field is **ignored, not rejected** (hostile body; a
  harmless extra field).
- `run(ctx, body, emit)`: `composeEvent(body.eventDescription, body.eventContext)`
  → `runModeB` with:
  - `serperQuery` = composed headline
  - `serperOpts: { recency: 'qdr:w' }`
  - default `marketStep` (CoinGecko, soft-fail) — token-linked news gets live
    price; otherwise snippet is null and the prompt skips it
  - `buildPrompt` → `buildNewsBreakdownPrompt(...)` (below)
- `preview(input)`: settle-free mirror of the paid path (best-effort serper +
  coingecko, `generateTweets`), exactly like `hotTake.preview`. **Never
  settles.**

### `lib/prompts/newsReaction.ts` (new)

- `buildNewsBreakdownPrompt({ event, searchSummary, marketSnippet })` enforcing
  a 4-beat thread:
  1. **What just happened** (opening tweet, cite source host)
  2. **Why it matters / context**
  3. **Who is affected + numbers** (use market snippet when present)
  4. **What to watch next**
- **Explicit neutrality constraints:** ban side-picking vocabulary
  (bullish/bearish/moon/dump…), ban buy/sell recommendations, require
  fact-vs-inference separation (inferences marked "likely/could"). Reuse the
  existing `bannedPhrases` machinery. llama-3.3-70b drifts toward hype, so
  these constraints are hard requirements, not style hints.
- Temperature: start at 0.85 (house default); expect to land near **0.7**
  (fact-bound > creative) — finalized during prompt iteration.
- `factCheckStep` runs as in Hot Take: for an "explain the news" mode, a wrong
  fact is the top reputational risk.

## Cost

Identical to Hot Take: **3 x402 settles** — Serper + Groq (gates delivery) +
factCheck; CoinGecko step carries no settle. Flat $0.05/thread revenue
unchanged. No contract change: `payForThread(token, uint8 mode)` does not
whitelist mode ids.

## Wiring & data (the mode-4 lesson: enumerate every gate)

### New

- `lib/pipeline/modes/newsReaction.ts` — descriptor (above)
- `lib/prompts/newsReaction.ts` — prompt builder
- `components/NewsBreakdownInput.tsx` — Hot Take form minus angle row; reuses
  `UrlPreviewCard` + OG fetch hook
- `supabase/migrations/0010_funnel_mode5.sql` — widen
  `funnel_events_mode_check` to `(0,1,2,3,4,5)` (copy of 0009 pattern;
  `threads.mode` has no CHECK)

### Modified

- `lib/pipeline/modes/index.ts` — register mode 5
- `lib/funnelTypes.ts` — widen `mode` union to include `5`
- **Repo-wide grep for the literal union `0 | 1 | 2 | 3 | 4`** — known sites:
  `app/HomeClient.tsx` (≥4 occurrences: payload mapping, `share`/`pay`/`submit`
  tracking), `lib/funnelReport.ts` (per-mode report list), `lib/funnel.ts` if
  gated
- `app/HomeClient.tsx` — `newsReaction` payload state (like `hotTake` minus
  `angle`), request-body branch `mode: 5` + `eventDescription` +
  `eventContext`, picker mapping `'news-breakdown'` → new screen
- `lib/screens.ts` — add `'news-breakdown'` to `Screen` union + `INPUT_SCREENS`
- `components/ModePicker.tsx` — entry at display position II, numeral VI
- `lib/threadLabel.ts` — mode-5 fallback label `'News Breakdown'` (topic is the
  headline, so rows usually self-label)

Funnel events (`mode_select`/`submit`/`preview`/`pay`/`share`) flow once the
gates above are widened — no new event types.

## Error handling

Entirely inherited from `runModeB`; nothing new:

- **Serper/CoinGecko soft-fail** → draft still ships. Kept soft (not
  fail-closed) because `composeEvent` already injects headline + OG description
  into the prompt — minimum viable grounding — and failing closed burns the
  user's $0.05 on a flaky Serper.
- Settle-gates-delivery, refund path, mid-run abort: unchanged.
- Dead URL / OG fetch failure: `composeEvent` falls back to the raw pasted
  text — existing prod-tested behavior.

## Testing

1. **Unit (Vitest):**
   - `newsReaction.test.ts` (mode): validateInput (missing `eventDescription`
     rejects; stray `angle` ignored), `run()` passes `qdr:w` + the news prompt
     to `runModeB`, `preview()` never settles.
   - `prompts/newsReaction.test.ts`: prompt contains the 4 beats + neutrality
     constraints.
   - Widen `funnelTypes` / `threadLabel` / `screens` tests accordingly.
2. **Type gate:** `npx tsc --noEmit` before pushing — a missed union-widening
   site surfaces here, not in `test:lib` (known CI gap).
3. **Runtime verify:** `/verify` skill (dev server + Playwright with mocked
   MiniPay): picker → headline input → preview → mocked pay.
4. **Prod acceptance:** after deploy, one real preview on prod **and confirm a
   mode-5 funnel event lands in the DB** — the exact spot mode 4 failed
   silently.
