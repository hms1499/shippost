# Generate-flow UX audit — CoinOp, 2026-08-19

A second pass, scoped to the one flow that spends the user's money: **unlock →
pay → `/api/generate/stream` → delivery, failure, or resume**. The first audit
(`2026-08-15-ux-flow-audit.md`) covered all ten flows broadly; this one goes
deep on the core and asks a narrower question:

> After the money leaves the wallet, does every path end somewhere the user can
> act on — and does the screen say something true while it gets there?

Method: **[code]** throughout. Nothing here was reproduced on a device this
session; every finding is established by reading the code, and each carries the
`file:line` that establishes it. Findings that need a device to confirm say so.

**Status 2026-08-19:** G1, G2, G3, G4, G5, G6 fixed in `dd27f2f`..`6335c91`
(unpushed). Each carries a Fixed note below. Fixes are verified by `tsc`,
`vitest` (791 pass) and `next build` — **not** on a device; the failure paths
they change need a real failing paid run to exercise.

Severity, unchanged from the first audit:

- **P0** — can lose money, or lose work the user already paid for.
- **P1** — states something untrue, or walks the user into a dead end.
- **P2** — unprofessional finish, or debt that will produce P1s later.

---

## Summary

| # | Finding | Sev |
|---|---|---|
| G1 | "Refund sent automatically" is not automatic — and a `failed` thread queues nothing at all | **P0** ✅ |
| G2 | A 402 leaves the user paid, told "refundable", and the refund button answers `thread not found` | **P0** ✅ |
| G3 | A failure that produced tweets promises "the working part of the thread" and never shows it | **P1** ✅ |
| G4 | The trace says "nothing was delivered" next to a card saying the opposite | **P1** ✅ |
| G5 | Returning to a run that failed dumps the user on the mode picker, silently | **P1** ✅ |
| G6 | "All steps failed" is usually false | P2 ✅ |
| G7 | The biggest money number on the paid screen is the one the user didn't pay | P2 |
| G8 | The paid amount during a live run is a display constant — wrong on prod Celo today | P2 |
| G9 | A ~6s dead window right after payment, with no line explaining it | P2 |
| G10 | A duplicate `startGen` in that window turns a delivering run into `HTTP 409` | P2 |
| G11 | The funnel's `share` stage counts deliveries, not shares | P2 |

The three to act on first are **G1**, **G2** and **G5** — all three are the same
shape: a user who paid, whose run did not deliver, and whose only remaining
in-app action does not work. All three are fixed, along with G3, G4 and G6.
What remains is the orphan payment (the open half of G2) and the truth-in-numbers
group.

---

## G1 — The refund is not automatic, and a `failed` run queues nothing — P0

Four surfaces promise an automatic refund:

- `components/ErrorSurface.tsx:77` — *"All steps failed. A full refund **will be
  sent automatically** within 24h."*
- `components/ErrorSurface.tsx:82` — cap-hit: *"a full refund will be sent
  within 24h."*
- `components/ErrorSurface.tsx:135` — *"auto refund queued — nothing was
  delivered"*
- `app/HomeClient.tsx:1122-1123` — the slow banner: *"if it can't finish, **a
  refund is sent automatically**."*

Two things are wrong with that.

**Nothing sends money.** `lib/agent/reconcile.ts:7-10` states it plainly — *"It
NEVER sends money: it enqueues a slow-cancel request… Draining the queue stays a
separate, human-gated step."* The drain is `pnpm refund:process <id>`, an admin
command (`CLAUDE.md`).

**And a failed run is never even enqueued.** The sweeper selects on
`.eq('status', 'pending')` (`lib/agent/reconcile.ts:49`). When the pipeline
throws, the route writes `status: 'failed'` (`app/api/generate/stream/route.ts:283`).
A `failed` row is therefore outside the sweeper's query forever. The *only*
thing that queues a refund for it is the user tapping **Request refund now**,
which posts to `/api/refund-request`.

So a user who reads "sent automatically" and closes the app is never refunded.
The copy actively discourages the one action that would have worked.

The card contradicts itself inside four lines, too: body says "sent
automatically" (`:77`), footer after tapping says *"Operator will process within
24h."* (`:158`).

**Fix:** say what happens. *"Tap below to queue a refund — an operator sends it
within 24h."* Then either make the button the only story, or extend
`reconcileStuckThreads` to also sweep `failed` rows with no `refund_tx_hash` and
no queued request, at which point "automatic" becomes true and the copy can
stay. The second is the better product, but it is a behaviour change, not a copy
fix.

**Fixed `dd27f2f` + `c2e4e86`** — both halves. `reconcileStuckThreads` gained a
second pass over `status='failed'` with `tweets IS NULL` and no
`refund_tx_hash`, queueing kind `full`; existing requests are looked up first so
the nightly run does not re-page ops. Copy on all four surfaces now names the two
real steps — the sweep queues, an operator sends. The partial card says the
opposite on purpose: the sweep skips delivered runs, so that refund is
user-initiated and the copy now says so.

---

## G2 — A 402 ends in `thread not found` — P0

The sequence, all of it in code that already exists:

1. `hooks/useThreadGeneration.ts:96-99` — any non-OK response becomes
   `fatal: 'HTTP ${res.status}'`. The response **body is discarded**, so the
   server's actual reason (`payment not verified: payment tx not found on
   chain`) never reaches the screen.
2. A 402 is returned at `app/api/generate/stream/route.ts:115` — **before** the
   `threads` insert at `:127`. No row is ever created.
3. `app/HomeClient.tsx:1170` renders `ErrorSurface kind="full-fail"`, whose
   primary action is `requestRefund('full')`.
4. `app/api/refund-request/route.ts:62-64` looks the thread up, finds nothing,
   and returns **404 `thread not found`**.
5. `components/ErrorSurface.tsx:160-161` prints that string verbatim under the
   button.

So the user sees: *"✗ pipeline fatal — **HTTP 402**. This run is refundable;
nothing was delivered"* (`components/AgentTrace.tsx:165`), taps the only button,
and is told **`thread not found`**. Their money is on chain. Nothing in the app
knows about it.

This is the client-visible face of the orphan-paid-thread bug already recorded
against Base threads `1000007`/`1000008`. The receipt-retry added in
`lib/agent/orchestrator.ts:106-122` makes a lagging RPC less likely to cause it,
but it did not close the path — it only made it rarer, and the UX on the
remaining path is still a dead end.

**Fix, in order of value:**

1. Insert the `threads` row (or a dedicated `orphan_payments` row) *before*
   verification, so a 402 is recoverable at all. This is the real fix and it is
   a server change.
2. Failing that: when the refund request 404s on a paid run, do not print the
   raw error — say what the user should do (*"We can't see this payment yet.
   Your tx: 0x… — send it to support / it will appear in history once the chain
   catches up"*), and show the pay tx hash, which the client still holds in
   `txHash`.
3. Surface the server's message instead of `HTTP 402`. `res.text()` is one line
   in `useThreadGeneration.ts:96-99`, and every message on that path was written
   to be read.

**Fixed `4c0c253`** — options 2 and 3; option 1 was rejected as the schema
decision, because a row written before verification can be created from a forged
body, and `reconcile` would then queue refunds for payments that never happened.
Fatals now carry a `fatalKind`: `pipeline` (a run the server started),
`rejected` (402/409/503 — no run), `network` (no answer, run continues). The
`run-not-started` surface drops the refund button that cannot work and shows the
pay tx copyable instead; `connection-lost` stops claiming a failure at all. The
server's own message replaces the status code.

**Still open:** the orphan payment itself. A 402 still leaves money on chain with
no record anywhere — the user can now act on it, but only by hand.

---

## G3 — Tweets that exist are never shown — P1

`app/HomeClient.tsx:476` gates the hand-off to the preview screen:

```ts
if (gen.isDone && gen.tweets && !gen.fatal) { … setScreen('preview'); }
```

The `!gen.fatal` means a run that produced tweets *and then* failed stays on
`generating` forever. On that screen:

- `components/AgentTrace.tsx` never renders `gen.tweets` — its only reference is
  the "drafting…" lock at `:154`;
- `app/HomeClient.tsx:1178` renders `ErrorSurface kind="partial"`, whose copy is
  *"You get the working part of the thread."* (`components/ErrorSurface.tsx:72`).

The app promises the working part and then shows an error card, a "Write
another" button that wipes the state, and nothing else.

**This state is reachable.** The 150s deadline (`route.ts:44`) fires after
`groq`'s `step_output` has already delivered tweets to the client
(`runModeB.ts:115`) while `factCheck` is still running → `withDeadline` rejects
→ `fatal`. The server even persists them: `tweets: capturedTweets` on the
failure path (`route.ts:282`). So the tweets exist in client state *and* in the
database, and the only way for the user to read them is `/history`.

**Fix:** route `fatal + tweets` to the `preview` screen with the partial card
above the thread, instead of holding it on `generating`. The refund request
stays exactly where it is — `partial` is already the right kind.

**Fixed `6335c91`.** Delivery is now decided by tweets arriving, not by how the
run ended, and the notice above the thread covers both reasons a thread can be
short — with the fatal outranking a degraded soft step.

Two things fell out of it. The receipt's `'0.001'` agent-spend fallback became
reachable (the stream reports a total only on `done`), so it now sums what
actually settled — `settledCostTotal`, the same costs the trace shows with their
tx hashes — and falls back to `'0.000'`, which reads as unknown. And a **resumed**
partial deliberately still points at history rather than re-rendering the thread:
history does render tweets, and carrying them through the resume state would add
a second partial-delivery path that cannot be exercised without a device.

---

## G4 — Two opposite claims in one viewport — P1

`components/AgentTrace.tsx:163-166` renders on *any* fatal:

> ✗ pipeline fatal — {reason}. This run is refundable; **nothing was delivered**.

`AgentTrace` is still mounted (`app/HomeClient.tsx:1013`) when the partial card
renders below it (`:1178`) saying **"You get the working part of the thread"**.
On a partial failure both are on screen at once.

`ErrorSurface` already models this correctly — `isAutoRefundNoDelivery`
(`ErrorSurface.tsx:119`) exists precisely to keep the "nothing was delivered"
line off the partial card. `AgentTrace` just doesn't have the same condition.

**Fix:** gate the `AgentTrace` line on `!gen.tweets`, matching `:119`.

**Fixed `c2e4e86`.**

---

## G5 — Coming back to a failed run is a silent bounce — P1

`app/HomeClient.tsx:294-299`:

```ts
} else if (resumeState.state === 'failed') {
  resumeApplied.current = true;
  setScreen('mode');
  clearPaidRun();
  setResumingRun(null);
}
```

`components/ResumingRun.tsx` has branches for `checking` (`:43`) and `gone`
(`:50`) — and none for `failed`. So a user whose webview died mid-run, who
reopens CoinOp and reads *"the agent kept working while you were away. Nothing
was lost"* (`ResumingRun.tsx:38-41`), lands on the **mode picker** a few seconds
later with no message, no thread, and no refund path. `clearPaidRun()` has also
removed the record, so they cannot get back to it.

That population is precisely the one most likely to be owed money: their run
failed. Resume, the feature built to protect them, hands them the emptiest
screen in the app.

Note `interpretThreadRow` (`lib/resumeRun.ts:44`) also maps *completed with no
tweets* to `failed`, so this covers delivered-nothing runs too.

**Fix:** a `failed` branch on `ResumingRun` that states the run failed and
offers the same `requestRefund('full')` action the live path offers. It needs
`threadId` from `resumingRun`, not from `usePayForThread` — see G5a.

**Fixed `1902d9d`** — plus one thing the finding missed: `ResumeState.failed`
had to carry `delivered`, because a failed run that still wrote tweets is a
partial delivery and a `full` refund there pays the user back for a thread they
can read. Delivered → `partial` card pointing at history; not delivered →
`full`. The record is now cleared when the user leaves, not for them.

### G5a — `requestRefund` is a silent no-op without a live pay — P2 ✅

`app/HomeClient.tsx:534` opens with `if (!address || !threadId) return;` and
`threadId` comes from `usePayForThread`, which a resumed session never populated.
No status is set, so the button would do **nothing at all** — no spinner, no
error. Any refund action added to the resume path must read the id from
`resumingRun.threadId` first.

---

## G6 — "All steps failed" is usually false — P2

`components/ErrorSurface.tsx:77` opens with *"All steps failed."* The common
shape of a full failure is the opposite: soft steps settle, then the hard Groq
step throws (`runModeB.ts:101-105`). The stepper directly above the card shows
`SERPER ✓ $0.001` while the card says all steps failed
(`components/AgentTrace.tsx:118-120`).

**Fix:** *"The thread couldn't be generated."* — true in every case that reaches
this card.

**Fixed `c2e4e86`**, as a side effect of rewriting that body for G1.

---

## G7 — The prominent number is the one the user didn't pay — P2

`components/AgentTrace.tsx:95-97` puts **`SPENT $0.003`** in the header, in
`text-money`, top-right, on every frame of the run. That is CoinOp's x402 spend.
What the user paid appears once, as an amount on a log row (`:138`).

This is finding 2.1 from the first audit, in a second location — and the paid
screen is a worse place for it, because the user just parted with money and the
screen's biggest number is somebody else's.

**Fix:** invert it. `PAID $0.05` in the header; agent spend as the sub-line it
already has per step.

---

## G8 — The live run prints a constant, not the price paid — P2

`components/AgentTrace.tsx:138` labels the payment row with `THREAD_PRICE_LABEL`.
This is first-audit finding 6.4, still open, and it is no longer theoretical:
prod Celo's payment contract charges **$0.05** while the constant says
**$0.10**, so every MiniPay user on the current prod contract watches their run
print a price they were not charged. `CLAUDE.md` is explicit that
`THREAD_PRICE_LABEL` is a display fallback only.

The verified amount already exists server-side — `verifiedAmountRaw`
(`route.ts:112`). **Fix:** carry it on the `started` event
(`lib/pipeline/types.ts:13`) and render that, keeping the constant as the
fallback for the frames before it arrives. That also fixes the receipt's live
path (`PostShareScreen`'s `computeTokenAmount` fallback,
`app/HomeClient.tsx:1069-1082`), which the resumed path already gets right.

---

## G9 — A silent ~6s gap right after paying — P2

Between "payment confirmed" and the first pipeline event the route runs
`verifyPayment`, which can retry the receipt lookup **4 times at 1.5s**
(`lib/agent/orchestrator.ts:106-107`) plus the `requiredAmount` read, before the
`started` event is emitted (`route.ts:213`). During that window `AgentTrace`
shows one row — "payment confirmed" — and a blinking cursor. No step cells
exist yet (`:78` filters to non-pending steps), and the stall watchdog does not
fire until 60s (`useThreadGeneration.ts:20`).

The moment right after money leaves is the worst moment to show nothing.

**Fix:** emit a `verifying` line before `verifyPayment` — or, since the stream
isn't open yet, have the client print *"verifying payment on chain…"* the
instant it POSTs. One string, no protocol change.

---

## G10 — A duplicate start in that window reports `HTTP 409` on a healthy run — P2

The generation effect (`app/HomeClient.tsx:365-472`) is guarded by
`gen.hasStarted`, which only becomes true when the first SSE event lands — i.e.
after the G9 window. During those seconds the effect can re-run, because its
deps include the six payload objects (`:466-471`), and `applyToken`
(`app/HomeClient.tsx:678-694`) replaces the payload object on a chain change.

If that happens: `startGen` runs again, `abortRef.current?.abort()`
(`useThreadGeneration.ts:61`) tears down the first stream reader, the second POST
hits the unique index and returns **409** (`route.ts:143-145`), and the user is
shown a fatal for a run that the server is completing normally — with the tweets
landing in the database and never on screen.

Narrow (it needs a wallet-side chain switch in a ~6s window) but the failure is
loud and wrong. **Fix:** latch on `threadId` with a ref, the way `paidTracked`
already does at `:489-492`.

---

## G11 — `share` counts deliveries — P2

`app/HomeClient.tsx:480` fires `track('share', …)` inside the *delivery* effect,
the moment a thread reaches the preview screen. Nothing is shared at that point.

Meanwhile the "I posted it →" button (`:1057-1063`) carries a comment saying it
is the self-reported share signal and *"When the funnel is instrumented (C1),
record this as a self-reported 'claims posted' event"* — and calls nothing.

So the `share` stage (`lib/funnelTypes.ts:12`) is ~100% of successful paid runs
by construction, and pay→share tells you nothing. Given the funnel is what is
being used to reason about distribution, this one silently corrupts the decision
it exists to inform.

**Fix:** rename the delivery event to what it is (`deliver`, appended to
`FUNNEL_STAGES`), and move `track('share')` onto the "I posted it" button.
`FUNNEL_STAGES` is append-only in practice — check the report
(`lib/funnelReport.ts`) before renaming an existing stage.

---

## Status of first-audit findings inside this flow

| # | Finding | Status |
|---|---|---|
| 6.1 | Paid run dies on back gesture / reload | **Fixed** — `popstate` + `beforeunload` (`HomeClient.tsx:302-328`), `lib/paidRun.ts`, resume path |
| 6.2 | `target="_blank"` mid-run ejects the webview | **Open** — `AgentTrace.tsx:174` (agent wallet), `:217` (per-step tx). `ResumingRun.tsx:14-17` cites this finding and deliberately avoids it; `AgentTrace` still has it |
| 6.3 | No sense of how much longer | **Open** — still only the 60s stall watchdog; the stepper still renders only started steps (`AgentTrace.tsx:78`) |
| 6.4 | Paid amount is a display constant | **Open** — see G8 |
| 7.1 | Receipt recomputes the split in floating point | **Open** — `PostShareScreen.tsx:54-57` unchanged |
| 7.2 | Two more `target="_blank"` on the receipt | **Open** — `PostShareScreen.tsx:171, 243` |
| 1.1 | Landing promises "only if you keep it" | **Open** — `LandingHero.tsx:50`, `GuestTaste.tsx:54`. G1 makes this worse: the refund the copy leans on is manual and, for a failed run, not queued at all |

---

## Suggested order

1. ~~**G1 + G2 + G5**~~ — done 2026-08-19.
2. ~~**G3 + G4**~~ — done 2026-08-19.
3. **G8 + 6.4 + 7.1** — truth in numbers: carry the verified amount to the
   client, derive the receipt split from it. `settledCostTotal` (G3) took the
   agent-spend half of this; the *paid* amount is still a display constant, and
   on prod Celo it is wrong today.
4. **G7, G9, G10, G11** — emphasis, the post-payment gap, the duplicate-start
   latch, and the two instrumentation corrections.
5. **The orphan payment** (the half of G2 left open) — still needs the schema
   decision, and is the only remaining way a paid user ends up with no record at
   all.

Not yet exercised on a device: every failure path touched above. A real failing
paid run is the only thing that proves them, and the 2026-08-18 lesson applies —
when verifying a recovery path, the interruption itself has to be part of the
test.
