# Paid-run survival — surviving a back gesture or reload mid-run

**Date:** 2026-08-18
**Status:** design approved, not yet planned
**Fixes:** finding **6.1** (P0) in `docs/superpowers/plans/2026-08-15-ux-flow-audit.md`
**Scope:** client-side run persistence and a read-only resume path. The payment
path, `/api/generate/stream`, the pipeline and the contracts are untouched.

## Why now

6.1 is the only P0 in the audit. Every other finding is honesty or finish; this
one loses a screen the user has already paid for, in the wallet where the
gesture that triggers it is a reflex.

## The bug

CoinOp is a single page. Every screen is one variable in memory:

```
app/HomeClient.tsx:163
const [screen, setScreen] = useState<Screen>('mode');
```

Selecting a mode does not change the URL or navigate; it calls `setScreen` and
React re-renders. The only thing written to storage anywhere in that file is an
analytics flag (`app/HomeClient.tsx:124`, `coinop.funnel.visited`). `screen`,
the six payload states, `threadId` and `txHash` are all plain React state.

React state dies on reload. For an input screen that is an annoyance — the topic
can be retyped. There is exactly one screen where it is not:

```
user taps "Generate full thread · $0.10"
  → wallet sheet, user signs
  → payForThread() lands on chain          ← real money, irreversible
  → setScreen('generating')                  app/HomeClient.tsx:648
  → SSE stream runs 20–40s
  → tweets render
```

If the page dies in the middle — Android back gesture in the MiniPay webview, or
the OS reclaiming the webview for memory — `screen`, `threadId` and `txHash`
vanish together. The user reopens the app to an empty mode picker, seconds after
spending $0.10.

## What is not broken

Established by reading the code, and it bounds the fix:

| Concern | Reality | Evidence |
|---|---|---|
| Money lost | No — on chain, permanent tx hash | on-chain |
| Server dies too | No — the route runs to completion and writes the result | route is server-side |
| Re-running double-charges | No — unique constraint on the payment returns `409 thread already generated` | `app/api/generate/stream/route.ts:127-160` |
| Thread lost | No — recoverable in `/history` | `components/HistoryList.tsx` |

The thread survives on the server; only the client's way back to it is missing.
So the fix is **remember, then fetch** — never re-run. Re-running is not merely
wasteful, it is rejected: the server answers 409.

A completed run leaves this in the row (`app/api/generate/stream/route.ts:233-245`):
`tweets`, `total_cost_usd`, `groq_tx_hash`, `serper_tx_hash`,
`fact_check_tx_hash`, `search_summary`, `market_snippet`, `status`, plus
`token_symbol` and `pay_tx_hash` from the insert. Enough to rebuild the result
screen. Not stored: the coingecko step's tx hash and the per-step cost amounts,
which reach the live UI only over SSE.

**Accepted consequence:** a resumed run shows a thinner receipt than one watched
live — same tweets, same total spent, but no per-call breakdown. This is not a
new branch to build: `settledCalls` skips any step without a `costAmount`
(`lib/receiptText.ts:33`), and `PostShareScreen` already collapses an empty call
list to a single `agent spend $X` line (`components/PostShareScreen.tsx:124-134`).
The resume path passes `initialState.steps` and lets that existing fallback run.

The rejected alternative is filling the gap with `X402_UNIT_COST_USD`. Every
call does cost that constant today, so the number would usually be right — but
printing a constant on a receipt beside real tx links is exactly the defect
finding 7.1 documents. An honest omission beats a plausible fabrication.

## Decisions taken

Recorded with their reasons, because each has a plausible opposite.

**Persist only the paid run, not the whole flow.** A draft topic can be retyped;
a payment cannot be unmade. The narrow scope also avoids consolidating the six
mutually-exclusive payload states (`app/HomeClient.tsx:163-169`) — finding C.1 —
which would be required to serialise `screen`. C.1 stays open and unblocked.

**`localStorage`, not `sessionStorage`.** The audit says sessionStorage; that is
wrong for this failure. A back gesture can tear down the webview, and
sessionStorage dies with it — precisely the case being fixed. The cost is
managing the lifetime by hand: a 30-minute TTL plus explicit clears replace
"dies with the tab".

**Resume automatically, do not ask.** The user has just lost their screen after
paying. Landing them on a banner with a "check now" button spends their
attention on a step the app can take itself.

**A dedicated read endpoint.** `/api/public/threads` carries `revalidate = 30`
(`app/api/public/threads/route.ts:5`), so polling it could show up to 30 seconds
of stale state to a user who is already waiting. Widening that route with a
no-cache branch would put two opposite caching behaviours in one handler that
also serves `/history`.

**Query params, not a dynamic segment.** `app/api` has no `[param]` route today.
`/api/thread?chainId=&threadId=` matches the existing `/api/public/threads?wallet=`
shape rather than introducing a routing convention for a single route.

**Guards are analgesic, not the cure.** `beforeunload` and a `popstate`
interceptor are included, but nothing depends on them — neither is reliable in an
Android webview, and the OS reclaiming the process fires no handler at all.
Resume is what makes the run recoverable.

## Design

### 1. `lib/paidRun.ts` — the memory

Pure module, no React, unit-testable.

```ts
export interface PaidRun {
  v: 1;
  chainId: number;
  threadId: string;   // bigint as a decimal string — JSON has no bigint
  payTxHash: string;
  mode: 0 | 1 | 2 | 3 | 4 | 5;
  tokenSymbol: string;
  wallet: string;     // lowercased
  startedAt: number;  // epoch ms
}

export function savePaidRun(run: PaidRun): void;
export function loadPaidRun(): PaidRun | null;
export function clearPaidRun(): void;
export function isResumable(
  run: PaidRun,
  ctx: { now: number; wallet: string; chainId: number },
): boolean;
```

Key `coinop.paidRun.v1`. `isResumable` is a pure predicate, tested directly:
false on version mismatch, on `now - startedAt > 30 min`, on a different wallet
(compared lowercased), on a different chain.

Every storage access is wrapped in `try/catch`. Some webviews throw on
`localStorage` access; a throw here must degrade to "no saved run", never
propagate. `loadPaidRun` also returns `null` on unparseable or malformed JSON —
a corrupt entry is treated as absent, not as a crash.

`mode` is stored so the resumed screen can label the thread via
`lib/threadLabel.ts`, matching what `/history` shows.

### 2. `GET /api/thread?chainId=&threadId=` — the read path

```
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';   // never cached; a waiting user needs the current row
```

- `chainId` validated with `isSupportedChain` (`lib/chainPolicy.ts:30`) — per
  CLAUDE.md the only allowlist. Reject → 400.
- `threadId` must match `/^\d+$/`. Reject → 400.
- Read-only, service-role Supabase, same as `app/api/public/threads/route.ts`.
- 200 `{ status, tweets, topic, amountPaidRaw, totalCostUsd, tokenSymbol,
  payTxHash, walletAddress }`; 404 when no row matches. `amountPaidRaw` is the
  row's `amount_paid_raw`, written from the **on-chain verified** amount
  (`app/api/generate/stream/route.ts:133`) — it is what makes a resumed receipt
  able to state the price without reading the head price. `topic` is included because
  `threadLabel({ mode, topic })` (`lib/threadLabel.ts:48`) needs it to name the
  thread the way `/history` does. The per-step tx hashes are deliberately **not**
  returned: without their cost amounts the receipt cannot render them, so
  shipping them would be dead payload.

No new data is exposed: `/api/public/threads` already returns `tweets` with the
wallet filter optional (`app/api/public/threads/route.ts:26`), so paid content is
already publicly readable. That is a real finding and it is **out of scope here**
— logged for a separate decision, not changed by this work.

### 3. `hooks/useResumeRun.ts` — the poll

Given a `PaidRun`, polls the endpoint every **3s** for at most **3 minutes**, then
stops and offers `/history`.

| Row status | Result |
|---|---|
| `pending` | keep polling |
| `completed` | `{ state: 'done', tweets, totalCostUsd, … }` |
| `failed` | `{ state: 'failed' }` → existing `ErrorSurface` refund copy (Flow 8, no audit findings) |
| 404 / cap reached | `{ state: 'gone' }` → link to `/history` |

Polling stops on unmount and never restarts a stream.

### 4. Wiring into `HomeClient`

- **Write** — in the effect at `app/HomeClient.tsx:388-397`, which already fires
  on `status === 'success' && threadId != null` to track the `pay` funnel event.
  The run is recorded there, before the SSE stream can finish.
- **Clear** — at the three existing `reset()` sites (`:909`, `:955`, `:996`):
  "write another", and the two post-failure exits.
- **Restore** — an effect after `mounted && isConnected`: `loadPaidRun()`, then
  `isResumable`, then screen `'resuming'` with the poll running. On `done`,
  `setDraftTweets(tweets)` and `setScreen('preview')` — the ordinary flow from
  there on.
- **`'resuming'`** added to the `Screen` union in `lib/screens.ts`, grouped with
  the output screens.
- **`post-share` after a resume** — it is guarded on `activeToken`
  (`app/HomeClient.tsx:895`), which the resume path has no payload to supply.
  Rebuild a `TokenConfig` from the stored `tokenSymbol` via `getTokens(chainId)`
  (`lib/tokens.ts:81`) for decimals, and take the **amount from the database
  row**, not from `computeTokenAmount()`. CLAUDE.md is explicit that a past
  payment must never be derived from the head price. Likewise `agentSpentUsd`
  comes from the row's `total_cost_usd`, never from the `'0.001'` fallback the
  live path uses. `steps` is passed as `initialState.steps` so the existing
  empty-calls fallback prints one honest total line — `PostShareScreen` needs no
  change.

The resumed screen states plainly that the run was already paid for, shows the
thread id and pay tx, and says the agent kept working — the user's first question
on reopening is whether their money is gone.

### 5. Guards

On entering `generating`, `history.pushState` so the first back press is caught
by a `popstate` listener and returns into the app instead of closing the webview;
a `beforeunload` handler while a paid run is in flight covers desktop reload.
Both are removed when the run reaches a terminal state.

## Out of scope

- **6.4 / 7.1** — the live path still labels the payment with
  `THREAD_PRICE_LABEL` (`components/AgentTrace.tsx:138`) and recomputes the
  50/40/10 split in floating point (`components/PostShareScreen.tsx:54-57`).
  That is the "truth in numbers" pass. The resume path is written correctly from
  the start so it adds no new debt.
- **C.1** — the six payload states stay as they are.
- **Public readability of `tweets`** — noted above, decided separately.

## Testing

**Unit — `lib/paidRun.test.ts`:** save/load round trip; version mismatch;
expired TTL; wrong wallet; wrong chain; `localStorage` throwing; malformed JSON.

**Route — `app/api/thread/route.test.ts`:** unsupported chain → 400; non-numeric
threadId → 400; no row → 404; completed row → expected shape. Follows
`app/api/preview/route.test.ts`.

**Runtime — the repo's `verify` skill**, dev server at 390×844 with a mocked
injected wallet. **No real payment required:** seed `localStorage` with a
`PaidRun` pointing at a `threadId` that already exists, then reload. That
exercises restore → poll → render end to end. The original audit verified 6.1 the
same way ("via the reload proxy, not by killing a real paid run").

**Gates:** `pnpm test:lib`, `pnpm test:contracts` (unchanged, must stay green),
`npx tsc --noEmit` — local `test:lib`/`build` skip typechecking `*.test.ts`, only
this catches it — `pnpm lint`, `pnpm build`.

## Footprint

New: `lib/paidRun.ts`, `app/api/thread/route.ts`, `hooks/useResumeRun.ts`, plus
two test files. Modified: `lib/screens.ts`, `app/HomeClient.tsx`. No contract, no
payment path, no `/api/generate/stream` change.
