# UX flow audit — CoinOp, 2026-08-15

A flow-by-flow pass over the whole product, looking for two things: places the
UI says something that is not true, and places a user can lose work or money.

Every finding below carries a `file:line` and how it was established:

- **[runtime]** — reproduced on a dev server at 390×844 with a mocked injected
  wallet (the `verify` skill), against live mainnet balances.
- **[code]** — established by reading the code; not reproduced on a device.

Severity:

- **P0** — can lose money, or lose work the user already paid for.
- **P1** — states something untrue, or walks the user into a dead end.
- **P2** — unprofessional finish, or debt that will produce P1s later.

Scope note: the wallet/chain flow was reworked earlier the same day
(`c4d3701`..`8599e2d`) and its findings are already fixed; they are not repeated
here except where a neighbouring flow still has the same class of bug.

---

## Summary

| # | Flow | P0 | P1 | P2 |
|---|---|---|---|---|
| 1 | Arrival & connect | — | 2 | 1 |
| 2 | Mode selection | — | 1 | 1 |
| 3 | Input forms | — | 1 | 2 |
| 4 | Free preview | — | — | 1 |
| 5 | Payment | — | — | 1 |
| 6 | Generating (paid) | 1 | 1 | 2 |
| 7 | Result & receipt | — | 1 | 1 |
| 8 | Errors & refund | — | — | — |
| 9 | History | — | — | — |
| 10 | Stats | — | — | — |
| — | Cross-cutting | — | — | 1 |

The two findings worth acting on first are **6.1** (a paid run dies on a back
gesture or refresh) and **3.1** (the form keeps a token from the chain the user
just left). Everything else is honesty and finish.

---

## Flow 1 — Arrival & connect

`components/LandingHero.tsx`, `components/GuestTaste.tsx`,
`components/AgentTraceReplay.tsx`, MiniPay auto-connect + wrong-network gate in
`app/HomeClient.tsx`.

### 1.1 The landing promises a refund policy the product does not have — P1

`components/LandingHero.tsx:26-27`

> Type a topic, get a ready-to-post X thread in ~20s. Pay **$0.10 only if you
> keep it**.

Payment happens *before* the thread exists: `PreviewLocked` → `unlock()` →
`pay()`, and the thread is generated afterwards. Refunds cover a **failed run**,
not a thread the user read and disliked. `components/GuestTaste.tsx:51` carries
a softer version of the same claim.

The honest version of this sentence is the one already used on the input forms:
*"The first tweet is free. You pay X only if you unlock the full thread."*
Either adopt that wording, or actually honour "only if you keep it" with a
post-delivery refund window — which is a product decision, not a copy fix.
**[code]**

### 1.2 The landing links to transactions that do not exist — P1

`components/AgentTraceReplay.tsx:14,16,18,20,58`

The landing replays a canned run through the real `AgentTrace` component. That
component renders every `txHash` as a link to the block explorer
(`components/AgentTrace.tsx:206-214`), so the landing ships tappable links to
`0xdemo000…`, `0x91ac000…`, `0x33bd000…`, `0x55ef000…` — hashes that resolve to
nothing.

Directly underneath sits `components/LandingHero.tsx:36`: *"A real run: the
agent pays each AI service on-chain via x402 micropayments."* The page asserts
the run is real and then hands the visitor four links that prove it is not. This
is the first screen a new visitor sees.

Fix by suppressing tx links in replay mode (a `replay` prop on `AgentTrace`, or
`txHash: undefined` in the canned events — `lib/traceLog.ts:57` already drops
`0x0` this way), or by pointing the replay at one genuine historical run.
**[runtime]** — the links render on the landing with no wallet connected.

### 1.3 A dead Connect button with no explanation — P2

`components/LandingHero.tsx:44` — `disabled={!openConnectModal}`. When
RainbowKit cannot open (its modal context missing), the only CTA on the page is
disabled and says nothing about why. Same class as the MiniPay timeout dead end
fixed in `8599e2d`, which now offers a retry and a reason. **[code]**

---

## Flow 2 — Mode selection

`components/ModePicker.tsx`

### 2.1 The price the user pays is less prominent than the price they don't — P1

`components/ModePicker.tsx:100-102` puts `agent $0.003` on every row, in
`text-money` accent. The actual price, `$0.10`, is one 11px line in the footer
(`:117-118`).

`agent $0.003` is what *CoinOp* spends on x402 calls — interesting proof of
work, but it is not a number the user is ever charged. Six rows advertise it;
one footer line states the real price. Invert the emphasis. **[code]**

### 2.2 A dead field with a comment defending it — P2

`components/ModePicker.tsx:13` declares `numeral`, `:21-27` is a seven-line
comment explaining why the numerals are deliberately not the on-chain mode ids,
and `:31,40,49,57,66,75` set them to `I`..`VI`.

Nothing renders it. `:96` renders `String(i + 1).padStart(2, '0')`. The comment
is worse than the dead field: it explains a decision the code does not make, so
the next reader trusts it. Either render `numeral` or delete both. **[code]**

---

## Flow 3 — Input forms

`components/{Educational,HotTake,NewsBreakdown,TokenAnalysis,DailyRecap,ChainComparison}Input.tsx`,
`components/TokenSelector.tsx`

### 3.1 Switching chain on the form leaves a token from the old chain — P1

Reproduced: on Celo, open **Educational Thread**, pick **cUSD** in the token
selector, then switch to Base from the wallet sheet. Result:

- the token selector trigger renders **empty** — no token, no placeholder;
- the fine print still reads *"You pay **0.10 cUSD** only if you unlock the full
  thread"* — cUSD does not exist on Base;
- the insufficient-balance warning still names cUSD;
- the CTA stays **enabled**.

Cause: `selectedToken` is component state
(`DailyRecapInput.tsx:37` and the same line in all six forms) and nothing resets
it when `chainId` changes. `effectiveToken` therefore keeps a `TokenBalance`
holding a **Celo token address** while the app is on Base, and submitting
captures it into the payload.

Money is not at risk — `assertTokenOnChain` (added in `0a79726`) rejects it at
the pay step — but the user fills in a whole form and hits the wall late, having
been shown a token they cannot pay with. This is the same defect class that
`8599e2d` fixed one screen later, on the preview; the input screen was missed.

The fix already exists: `reselectTokenForChain` in `lib/chainChoice.ts`. It
needs to run here too. **[runtime]**

### 3.2 The same token block is copy-pasted six times — P2

`defaultToken` / `selectedToken` / `effectiveToken` / `insufficient` /
`amountStr` / the `isLoading` branch / `TokenSelector` appear identically in all
six forms — e.g. `DailyRecapInput.tsx:30-51` and `EducationalInput.tsx:36-49`.

This is why 3.1 is six bugs rather than one, and why the next token change will
be six edits with one forgotten. Extract a `usePaymentToken(chainId)` hook (or a
`<PaymentTokenField>`), and fix 3.1 inside it once. **[code]**

### 3.3 Back link is a 56×16px tap target — P2

Measured at 390×844: the "Modes" back control is **56×16**, against a 44px
floor on both iOS and Android. Same shape in every form (`DailyRecapInput.tsx:55-65`).

For reference, measured on the same screen: token select 332×40, primary CTA
332×44, wallet chip 147×32. The house convention is 36px (`h-9`) nibs, so raise
these as a set, not one at a time. **[runtime]**

---

## Flow 4 — Free preview

`components/PreviewLocked.tsx`, `preview-unavailable` in `app/HomeClient.tsx`

### 4.1 "Regenerate sample" tap target — P2, unverified

`components/PreviewLocked.tsx:63-71` is a bare text button in the same shape as
3.3, so it is very likely under the floor too. Not measured — reaching this
screen costs a live preview call. Measure it while fixing 3.3. **[code]**

Otherwise this flow is in good shape: `preview-unavailable` correctly refuses to
silently fall through to a charge, and now states the token and chain
(`5574f29`).

---

## Flow 5 — Payment

`components/PayContext.tsx`, `lib/usePayForThread.ts`, `spend-unavailable`

Reworked earlier today. The pay moment now names the token and chain, gas is
claimed only when `wallet_getCapabilities` confirmed it, and `unlock()` refuses
a zero balance instead of opening a wallet sheet that will revert.

### 5.1 The balance is still not shown at the moment of paying — P2

The input screens warn when a balance will not cover the unlock
(`DailyRecapInput.tsx:138-144`), but `PreviewLocked` does not carry the number
forward — it shows the token and chain, not how much of it the user holds. The
warning exists two screens earlier and is gone exactly where the decision is
made. Carrying it into `PayContext` is a small change. **[code]**

---

## Flow 6 — Generating (after payment)

`components/AgentTrace.tsx`, `hooks/useThreadGeneration.ts`

### 6.1 A back gesture or refresh destroys a run the user paid for — P0

There is no `popstate` handler, no `beforeunload`, and no persistence of screen
state anywhere in `app/HomeClient.tsx` — the only client storage is the funnel
session id (`:123-124`) and `lib/funnel.ts`. Screen, payload, `threadId` and
`txHash` are plain React state.

Reproduced cheaply: type a topic on the Educational form, reload, and the app
returns to the mode picker with everything gone. During `generating` the same
event discards a run that has already been paid for. In the MiniPay webview the
Android back gesture does this routinely, and there is no confirmation prompt.

`/history` is the mitigation and it works — the thread is recoverable there once
the server finishes — but the user's own screen is gone mid-run with no
explanation, immediately after they spent money. Recovery-after-the-fact is not
the same as not losing it.

The fix is to persist `{screen, payload, threadId, txHash}` to `sessionStorage`
and rehydrate on mount, plus a `beforeunload` guard while a paid run is in
flight. **[runtime]** — verified via the reload proxy, not by killing a real
paid run.

### 6.2 Explorer links can eject the user from the webview mid-run — P1

`components/AgentTrace.tsx:206-214` and `:165-172` render `target="_blank"`
links during the paid run. In the MiniPay webview this hands the user to an
external browser while the SSE stream is live — combined with 6.1, coming back
is not guaranteed.

`components/HistoryList.tsx` already treats this as a known hazard and demotes
its explorer link for exactly this reason. Apply the same treatment here, where
the stakes are higher because a run is in flight. **[code]**

### 6.3 No sense of how much longer — P2

`hooks/useThreadGeneration.ts:20` only sets `isSlow` after 60s with **no
forward progress**, and `app/HomeClient.tsx:927` renders it. A healthy run that
simply takes 40s shows no progress estimate at all, and
`components/AgentTrace.tsx:75` filters the stepper to steps that have already
started — so the user cannot see how many remain either. The landing promises
"~20s" (`LandingHero.tsx:26`); after paying, nothing tracks against that.
**[code]**

### 6.4 The paid amount shown is a display constant — P2

`components/AgentTrace.tsx:133` labels the payment row with
`THREAD_PRICE_LABEL`. `CLAUDE.md` is explicit that `THREAD_PRICE_USD` /
`THREAD_PRICE_LABEL` are display fallbacks only and that anything about a
specific thread's payment must come from that thread's own event. The verified
amount is available; use it. **[code]**

---

## Flow 7 — Result & receipt

`components/PostShareScreen.tsx`, `components/ThreadPreview.tsx`,
`components/ShareToX.tsx`

### 7.1 The receipt recomputes the split in floating point — P1

`components/PostShareScreen.tsx:54-57`:

```ts
const paid = Number(paidAmountUsd);
const agentShare = (paid * 0.5).toFixed(3);
const treasuryShare = (paid * 0.4).toFixed(3);
const reserveShare = (paid * 0.1).toFixed(3);
```

The contract splits in integer token units and sends the dust to the reserve
(asserted by `test/contracts` — "splits 50/40/10 exactly at the new price, dust
to reserve"). This is a *receipt*: it is presented as a record of what happened
on chain, with tx links beside it. At $0.10 the two agree; at a price that does
not divide evenly they will not, and the document that looks most authoritative
will be the wrong one. Derive the split from the on-chain amounts, or label
these as approximate. **[code]**

### 7.2 Two more `target="_blank"` links — P2

`components/PostShareScreen.tsx:168-175` and the per-row `tx↗`
(`:239-249`). Lower stakes than 6.2 — the run is finished — but the same webview
behaviour, so fix them together.

`ShareToX` is notably careful here by contrast (`components/ShareToX.tsx:14-20`
documents why it uses the https intent and never `twitter://`). That is the
standard the rest of the app should meet.

---

## Flow 8 — Errors & refund

`components/ErrorSurface.tsx`

Eleven error kinds, each with copy written for a specific failure, and the
comments show real care: `approve-failed` deliberately does not accuse the user
of cancelling, `pay-unconfirmed` is called out as the one case where retrying
could double-charge, and the wallet's own error string is shown verbatim and
made copyable rather than replaced with reassurance.

No findings. Not exercised at runtime — reaching these states needs a real
failing payment.

---

## Flow 9 — History

`app/history/page.tsx`, `components/HistoryList.tsx`

Empty state reads *"No threads yet — run your first one from the composer."*
with a way back. The panel names the chain. Rows expand in place and the
explorer link is deliberately demoted. No findings. **[runtime]**

---

## Flow 10 — Stats

`app/stats/page.tsx`. Public metrics, outside the paying user's path. Not
audited.

---

## Cross-cutting

### C.1 `HomeClient.tsx` is 1206 lines and owns every flow — P2

Screen state, six payloads, auto-connect, pay orchestration, generation, funnel
tracking, chain re-derivation, and the render tree for all ten screens live in
one component. Both P0/P1 findings above (6.1 and 3.1) are state-ownership
bugs, which is what a file this size produces.

Not a call to refactor it wholesale. But 6.1 needs a persistence layer, and that
is the natural moment to lift screen + payload state into a reducer or store
that can be serialised — fixing the bug and shrinking the file with the same
change.

---

## Suggested order

1. **6.1** — paid-run survival (P0). Persistence + rehydrate + unload guard.
   Pulls C.1 along with it.
2. **3.1 + 3.2** — one `usePaymentToken` hook, fixing the stale token once
   instead of six times.
3. **1.1, 1.2, 2.1** — the honesty pass: fix the refund promise, stop linking to
   fabricated transactions, make the real price the prominent one. Cheap, and it
   is the first screen every visitor sees.
4. **6.2, 6.4, 7.1, 7.2** — the truth-in-numbers pass: real paid amount, real
   split, webview-safe links.
5. **2.2, 3.3, 4.1, 5.1, 1.3** — finish work.

Each of 1–4 is its own spec → plan → implementation cycle.
