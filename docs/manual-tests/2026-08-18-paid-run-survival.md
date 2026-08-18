# Manual test — paid-run survival

**Feature:** a run the user has paid for survives losing its screen.
**Spec:** `docs/superpowers/specs/2026-08-18-paid-run-survival-design.md`
**Fixes:** finding 6.1 (P0) in `docs/superpowers/plans/2026-08-15-ux-flow-audit.md`

## What this is for

CoinOp is a single page: every screen is one React variable, and React state
dies on reload. For an input screen that is an annoyance. For the `generating`
screen it is not — that screen appears **after** money has irreversibly left the
wallet, and in the MiniPay webview the Android back gesture is a reflex.

The thread itself was never in danger: the server runs to completion and writes
the result. What was missing was the client's way back to it. Now the client
records the payment before it happens and fetches the result when it returns.

**Nine of the ten tests below cost nothing.** Only the last one spends real
money, and it is the only one that proves the real gesture.

---

## Setup

Works in the MiniPay webview (via remote debugging) or in a desktop browser at a
390×844 viewport. You need the devtools console to seed storage.

Reset between every test:

```js
localStorage.removeItem('coinop.paidRun.v1');
```

Pick a real thread to resume — any completed one belonging to **the wallet you
are connected with** (resume is wallet-scoped by design):

```
GET /api/public/threads?chainId=42220&limit=5
```

Take an entry whose `status` is `completed` and whose `tweets` is non-empty, and
note its `onchain_thread_id`, `wallet_address`, `token_symbol`, `pay_tx_hash`
and `mode`.

The seed used by every test below:

```js
localStorage.setItem('coinop.paidRun.v1', JSON.stringify({
  v: 1,
  chainId: 42220,
  threadId: '<onchain_thread_id>',
  payTxHash: '<pay_tx_hash>',
  mode: <mode>,
  tokenSymbol: '<token_symbol>',
  wallet: '<wallet_address, lowercase>',
  startedAt: Date.now(),
}));
location.reload();
```

---

## 1 — The endpoint answers (no browser needed)

```bash
curl 'http://localhost:3111/api/thread?chainId=42220&threadId=<id>'
```

**Expect** 200 with camelCase keys, including `amountPaidRaw` — the amount as
verified on chain when the thread was bought.

```bash
curl 'http://localhost:3111/api/thread?chainId=1&threadId=<id>'        # 400 unsupported chain
curl 'http://localhost:3111/api/thread?chainId=42220&threadId=abc'     # 400 invalid threadId
curl 'http://localhost:3111/api/thread?chainId=42220&threadId=999999999' # 404 not found
```

## 2 — The happy path

Seed as above and reload.

**Expect**, in order:

```
RESUMING RUN #<id>
paid · <TOKEN>
tx 0x…
<Mode name> — the agent kept working while you were away. Nothing was lost
and you will not be charged again.
⟳ checking for your thread…
```

then the preview screen with that thread's real tweets.

On a fast connection the panel is a flash. To actually look at it, throttle the
network in devtools or stall `/api/thread` — do not conclude it is missing just
because you did not see it.

## 3 — Nothing is generated twice

Open the Network tab **before** reloading in test 2.

**Expect:** no request to `/api/generate/stream` at any point. The only app
requests should be one `POST /api/public/funnel` (analytics) and one or more
`GET /api/thread`.

This is the test that matters most. A resumed run that re-issued generation
would be rejected `409` by the server, but the client should never ask.

## 4 — Someone else's payment is not resumable

Seed with `wallet` set to any other address, reload.

**Expect:** the mode picker, no resume panel, and the storage key **cleared**:

```js
localStorage.getItem('coinop.paidRun.v1');  // → null
```

## 5 — A payment from another chain is not resumable

Seed with `chainId: 8453`, reload. **Expect:** same as test 4 — mode picker, key
cleared.

## 6 — An old run is history's problem, not a resume

Seed with `startedAt: Date.now() - 31*60*1000` (the TTL is 30 minutes), reload.
**Expect:** mode picker, key cleared. The thread is still in `/history`.

## 7 — A run still in flight keeps waiting

Seed with `threadId: '999999999'` (no such row), reload.

**Expect:** the resume panel shows `checking for your thread…` and **stays
there**, polling every ~3s. It must not give up immediately — a client that died
right after the payment landed can arrive before the server has even created the
row.

## 8 — But it does give up eventually

Leave test 7 running for three minutes.

**Expect** the panel to switch to:

> This is taking longer than expected. Your thread is not lost — it appears in
> history as soon as the agent finishes.

with an **OPEN HISTORY** button.

Caveat: a backgrounded webview throttles timers, so on a real device this can
take longer than three minutes of wall clock. That is the browser, not the app.

## 9 — Corrupt storage does not break anything

```js
localStorage.setItem('coinop.paidRun.v1', '{not json');
location.reload();
```

**Expect:** the mode picker, no crash, and the key **cleared** — the loader
sweeps what it cannot read.

## 10 — The real one (costs one thread at the live price)

On a device, in MiniPay:

1. Run a paid thread normally.
2. The moment the amber `SPENT` line first appears, **swipe back** (or kill the
   app from the task switcher).
3. Reopen CoinOp.

**Expect:** `RESUMING RUN #…`, then your tweets.

Record what actually happened **including the thread id**, so a failure can be
diagnosed afterwards from the row.

---

## What "correct" looks like

- The resuming panel names the payment **before** anything else. The first
  question someone has here is whether their money is gone.
- The pay tx is shown as **plain text, never a link**. This screen exists
  because the user already lost the app once; a `target="_blank"` into an
  external browser is how that happens again (audit finding 6.2).
- Resume is **read-only**. It polls one row. It never generates.

## Known limits, by design

- **A resumed receipt shows one `agent spend $X` total, not per-call rows.** The
  database stores each step's tx hash but never its cost, and printing the
  `X402_UNIT_COST_USD` constant beside real tx links is exactly the defect
  finding 7.1 documents. An honest omission beats a plausible fabrication.
- **The amount paid comes from the row, not from today's price.** Verified on a
  thread bought at $0.05 while the current price is $0.10: the receipt reads
  `$0.050`. If you ever see the receipt agree with the *current* price on an old
  thread, that is a regression.
- **A client that died between the payment landing and the first
  `/api/generate/stream` request has no row to find.** It polls for three
  minutes, then points at history. That case is the refund path, not a resume.
- **The back-press and reload guards are not load-bearing.** Neither `popstate`
  nor `beforeunload` is reliable in an Android webview, and an OS-reclaimed
  process fires neither. They reduce how often recovery is needed; the resume
  path is what makes the run recoverable.
