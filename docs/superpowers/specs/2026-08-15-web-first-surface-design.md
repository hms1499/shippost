# Web-first surface — design

**Date:** 2026-08-15
**Status:** approved in brainstorm, ready for implementation planning

## Why

CoinOp was built for one surface: the MiniPay webview, 390px wide, a wallet the
user is already inside. The product is now web-first, with MiniPay as the second
option.

That reframe invalidates part of [the UX audit](../plans/2026-08-15-ux-flow-audit.md),
which was measured entirely at 390×844 — the surface just demoted. Re-measured at
web widths, three things are wrong that the audit never looked at:

- The whole app renders in a **448px column centred in a 1440px viewport**. The
  landing — the web front door — is a phone layout on a desktop screen.
- On desktop, every *input* screen renders a two-column grid whose **right column
  is empty**. Confirmed at 1024, 1440 and 1920. Desktop is worse than mobile for
  the first half of the flow.
- **MiniPay-only copy is shown to web users.** All six forms say "top up in
  **MiniPay**"; `components/ErrorSurface.tsx:62` says "Reopening CoinOp from
  **MiniPay** usually clears this". A person in Chrome has no MiniPay to reopen.

## Decisions

Settled during brainstorming; each is a fork not to re-litigate.

1. **Split the routes.** `/` is a marketing page; `/app` is the composer.
2. **`/app` on desktop is two panes, both always meaningful.** Left is the
   user's request, right is the agent.
3. **The visual identity does not change.** Agent Terminal stays; only layout,
   breakpoints and rhythm change. Nothing measured says the palette or type
   fails on desktop — a 448px column does.
4. **The mode screen has no right pane.** It runs full width as a 3×2 grid.
   Panes appear when they have something true to hold; anything else recreates
   the empty-column bug being fixed.
5. **The landing hero is a real run, replayed** — proof first, then the free
   taste below it.
6. **The paid-run persistence fix (audit 6.1, the only P0) joins this work.**
   Splitting the routes and building two panes *is* the state-ownership
   refactor that audit finding C.1 asked for. Adding persistence at that moment
   is cheap; deferring it means opening the same state twice.

## Shape

Two independent cycles. Part A ships a working app; Part B builds the front
door. Each gets its own implementation plan.

---

# Part A — the app

## A1. Route split

| route | contents |
|---|---|
| `/` | Marketing. Part A moves the existing `LandingHero` here; Part B rebuilds it. |
| `/app` | `HomeClient`. Wallet required. |

Three things break silently if the split is done naively. All three were
verified in the current code.

**The funnel's `visit` stage would be lost.** `track('visit')` fires inside
`HomeClient` (`app/HomeClient.tsx:125`). Move `HomeClient` to `/app` and every
person who lands on `/` and leaves stops being counted — which is the top of the
funnel. `visit` moves to `/`; `/app` keeps its own stage.

> Numbers before and after the cutover are not directly comparable. Record the
> cutover date so the discontinuity is not later read as a traffic collapse.

**`?ref=` capture must move to `/`.** `captureSource()` (`lib/funnel.ts:44`)
reads `?ref` from the URL and stores it in `sessionStorage`. Share links point at
the root (`lib/shareText.ts:shareAppUrl`), so by the time a visitor reaches
`/app` the query string is gone. Call `captureSource()` on `/`. A client-side
navigation `/` → `/app` then preserves attribution; a hard reload of `/app`
does not need it, because the value is already stored.

**MiniPay should not pass through the marketing page.** A MiniPay user is
already inside a wallet; the pitch costs them a beat. Two layers:

- change the registered MiniPay entry URL to `/app` — the real fix, and it lives
  outside this repo;
- a client-side redirect on `/` when `window.ethereum.isMiniPay` is true — the
  safety net for installs pointing at the old URL.

There is no `manifest.json` in `public/`, so there is no `start_url` to update.

Links already in the wild keep working. Anyone who bookmarked `/` as the app
pays one extra click.

**One thing Part A does not defer.** Moving the landing as-is would leave the
four links to non-existent transactions (audit 1.2) live on the front page until
Part B lands — an honesty project shipping a known falsehood in its first
release. The interim fix is one line: drop `txHash` from the canned replay
events, exactly as `lib/traceLog.ts:57` already drops `0x0`. The replay keeps
working; it simply stops offering proof it does not have. Part B then replaces
the whole thing with a real run.

## A2. State ownership and paid-run survival

**The bug.** `app/HomeClient.tsx` holds `screen`, six payloads, `threadId` and
`txHash` as plain React state, and persists nothing (the only client storage is
the funnel session id). A reload returns the user to the mode picker with
everything gone — reproduced. During `generating`, that discards a run they have
already paid $0.10 for. In the MiniPay webview the Android back gesture does it
routinely; on the web, refresh and the back button do it far more often.

**The lift.** Move `{screen, mode, payload, threadId, payTxHash, chainId,
tokenSymbol}` into one reducer with a serialisable shape, owned in one place.
This is the refactor the two-pane work forces anyway.

**Persist** that shape to `sessionStorage` on change, and rehydrate on mount.

**Discard the stored state unless the wallet address and chainId still match.**
A different wallet must never inherit a previous wallet's run.

**Rehydrating into `generating` must read the thread row — never re-POST to
`/api/generate/stream`.**

This is the one rule in Part A that must not be got wrong, so here is exactly
why. The server is already idempotent: `onchain_thread_id` carries a unique
constraint, and a replayed payment is rejected with
`409 thread already generated for this payment`
(`app/api/generate/stream/route.ts:142-144`). So money is safe either way — a
re-POST cannot double-charge.

The damage would be to the user's understanding. `useThreadGeneration.ts:98`
turns any non-OK response into `fatal: HTTP ${res.status}`, so a re-POST after a
reload shows `HTTP 409` — a fatal error on a run that in fact succeeded, and one
that invites a refund request for a thread that was delivered.

Recovery therefore reads the persisted row, exactly as `components/HistoryList.tsx`
already does: poll `/api/public/threads?wallet=…&chainId=…`, find the row for
`threadId`, and render its `tweets` when `status` is `completed`. The run may
well have finished while the tab was gone.

**Guard the unload** while a paid run is in flight (paid, not yet done) with a
`beforeunload` prompt. It is the last cheap thing standing between a stray
gesture and a lost screen.

## A3. Two-pane layout

The organising idea is already written down in the codebase, in
`components/ComposeSummary.tsx`:

> *"Left = what you asked; the right page shows what the agent forged."*

The current grid does the left half and leaves the right half empty. Part A
finishes it: **the right pane tells one story — what the agent is about to do,
what it is doing, what it did.**

| stage (`Screen`) | left pane | right pane |
|---|---|---|
| `mode` | *(no panes — full width, 3×2 grid)* | — |
| the six input screens | the form | the recipe: this mode's steps, what the agent spends, what you pay |
| `preview-locked` | `ComposeSummary`, read-only | the free first tweet, the locked remainder, and the pay CTA |
| `preview-unavailable`, `spend-unavailable` | `ComposeSummary`, read-only | the decision surface — why it stopped, and the way out |
| `generating` | `ComposeSummary`, plus the paid amount and tx | the live trace; the steps from the previous stage light up in place |
| `preview`, `post-share` | `ComposeSummary`, plus the receipt | the thread and the share controls |

Every member of the `Screen` union in `lib/screens.ts` appears above. A screen
with nothing true for the right pane gets no right pane, per decision 4.

Two audit findings close here as a side effect: **2.1** (the real price finally
has a proper home, instead of losing prominence to the `agent $0.003` figure the
user never pays) and **6.3** (the user knows how many steps a run has before it
starts, so the wait is legible).

### Breakpoints

| width | layout |
|---|---|
| ≥ 1280px | Two panes. Container grows from today's 896px to ~1200px — 896px on a 1920px screen is why desktop reads as empty. |
| 1024–1280px | Two panes, container fluid. |
| 768–1024px | Single column. The right pane drops *below* the left: compose first, then the agent. |
| < 768px and MiniPay | Unchanged from today. The right pane condenses to one expandable line ("4 steps · agent spends $0.003 · you pay $0.10") rather than pushing a full block onto a phone. |

`spread = !isMiniPay && isDesktop` (`app/HomeClient.tsx:146`) is replaced by this
ladder. MiniPay never gets two panes.

## A4. Declarative mode steps

The right pane needs to say which steps a mode runs. **That data does not
exist.** `ModeDef` (`lib/pipeline/modes/types.ts`) declares `id`, `key`,
`validateInput`, `run` and `preview` — the steps live inside the body of `run()`.

So the list has to be declared, and a declared list can drift from the code that
actually runs. A pane claiming four steps while the pipeline runs three is
precisely the "states something untrue" class this whole effort is clearing.

**Steps are conditional, so the declaration cannot be a flat list.** Read at
implementation-planning time:

- `runModeA` (mode 0) runs a **soft-fail** Serper search inside a `try/catch`
  that degrades to an ungrounded draft, then a **hard-fail** Groq draft.
- `runModeB` (modes 1–5) runs soft Serper, then CoinGecko only when the mode
  supplies a `marketStep` (and soft either way), then hard Groq, then soft
  fact-check.

A flat `steps: StepId[]` compared for equality would therefore fail on any run
where a soft step legitimately degraded. Declare optionality instead:

```ts
export interface ModeStep {
  id: StepId;
  /** Soft steps degrade instead of failing the run, so they may not happen. */
  optional?: boolean;
}
```

**The drift test asserts both directions**, because each catches a different
lie:

- every emitted `step_started` id appears in the declared list — catches a step
  running that the pane never mentioned;
- on a happy-path mocked run, every **non-optional** declared step is emitted —
  catches the pane promising a step the pipeline cannot run.

It must mock at the **step** level (`serperStep`, `coingeckoStep`, `groqStep`,
`factCheckStep`), not at `runModeB`. The existing mode tests mock `runModeB`
wholesale, so they never exercise step emission and cannot be extended for this.

The right pane renders optional steps as conditional rather than promised.

## A5. Surface-aware copy

Copy currently hardcodes MiniPay in seven places. Scattering
`isMiniPay ? … : …` at each site is how the next one gets missed.

Create `lib/surfaceCopy.ts`: one key per surface-dependent string, both variants
required, and a test asserting no key is missing a variant. "How much of the
product speaks MiniPay-only" becomes a list you can read instead of a grep.

| key | MiniPay | web |
|---|---|---|
| `insufficientBalance` | "…top up in MiniPay or switch token" | "…top up or switch token" |
| `walletUnavailable` | "Reopening CoinOp from MiniPay usually clears this." | "Check your wallet extension is unlocked, then retry." |

---

# Part B — the landing

Assumption this rests on: **a web visitor to CoinOp is necessarily crypto-native**
— the product cannot be used without a wallet and a stablecoin. The page does not
teach blockchain. It proves the thing works and states the price honestly.

Five bands:

1. **Headline.** Keep "One coin in. One thread out." Replace the line beneath it,
   which currently promises a refund policy that does not exist (audit 1.1).
2. **A real run, replayed.** The hero position. Same `AgentTrace` component as
   today, driven by a genuinely completed thread: real topic, real per-step
   settlement transactions, real cost.
3. **The free taste.** Type a topic, get a real first tweet, no wallet.
4. **The price, stated plainly.** What you pay, when you pay it, what happens if
   the run fails (audit 2.1).
5. **The six modes**, in the same 3×2 grid the app uses, so the move to `/app`
   does not jar. Then the CTA.

## B1. The replayed run must be real, and pinned

Today `components/AgentTraceReplay.tsx` feeds canned events through the real
`AgentTrace`, which renders every `txHash` as an explorer link
(`components/AgentTrace.tsx:206-214`). The landing therefore ships four tappable
links to transactions that do not exist — `0xdemo000…`, `0x91ac000…`,
`0x33bd000…`, `0x55ef000…` — directly beneath the sentence "A real run: the agent
pays each AI service on-chain via x402 micropayments" (audit 1.2).

Everything needed to make that true is already stored. The `threads` table holds
`serper_tx_hash`, `coingecko_tx_hash`, `groq_tx_hash`, `fact_check_tx_hash`,
`pay_tx_hash`, `topic`, `total_cost_usd` and `tweets` per completed thread.

**Pin one hand-picked completed thread as a constant** — topic, the four
settlement hashes, the paid amount, the tweets.

Not the most recent thread. `topic` is user-typed: reading the latest row hands a
stranger editorial control of the front page, and one crude topic becomes the
hero. A pinned example carries no content risk, needs no database call on the
landing, and its transactions stay true forever because chain history does not
change. Refreshing the example means editing a constant.

---

## Out of scope

- `/history` and `/stats` keep their current single column. They get their own
  pass.
- The remaining audit findings — 3.1 (stale token on the form), 7.1 (the receipt
  recomputing the on-chain split in floating point), 3.3 (tap targets), 2.2,
  4.1, 5.1, 1.3 — are not pulled in unless they fall directly on the path.
- The visual identity. Closed, deliberately (decision 3).

## Risks

| risk | handling |
|---|---|
| Funnel numbers discontinuous across the cutover | Record the date; do not read the step as a traffic change. |
| Declared mode steps drift from the pipeline | The A4 test fails the build instead. |
| The MiniPay entry URL is registered outside this repo | The `/` redirect covers old installs; the registration change is a separate operational task. |
| The pinned landing example goes stale | Accepted. It is a constant; refreshing it is an edit. Its transactions never stop being true. |
| Rehydrate re-POSTs a finished run | Covered explicitly in A2: recovery reads the thread row. The server's 409 protects the money; the rule protects the user's understanding. |
