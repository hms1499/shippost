# Preflight spend-readiness — never charge for a run we cannot settle

**Date:** 2026-07-27
**Status:** Approved design (pre-implementation)
**Approach:** A (gate before the user signs `payForThread`). B and C rejected — see below.

## Problem

`threads` holds 4 rows that are `failed` with the user's $0.05 already taken.
All four share one root cause, visible in `error_message`:

```
executeX402Call reverted: ERC20: transfer amount exceeds balance
2026-05-08 x2 (paid USDC)  ·  2026-07-24 x2 (paid USDT)
```

The user paid in USDC/USDT, the split delivered that token to AgentWallet, and
the pipeline then tried to spend **hardcoded cUSD** — of which AgentWallet held
none. That spend-token bug is fixed (`192a668`), so this exact revert is now
structurally dead (see "What the split already guarantees"). What is *not*
fixed is the shape of the failure: money leaves the user's wallet **before**
anything checks that the agent can settle at all. Any remaining reason a settle
cannot happen still produces "charged, no content, needs a refund".

## What the split already guarantees (why balance is NOT the check)

`ShipPostPayment.payForThread` (contracts/ShipPostPayment.sol:107-111) transfers
`agentShare` to AgentWallet **in the token the user paid**, in the same tx as
the payment:

```
pay $0.05  ->  50% = $0.025 lands in AgentWallet, correct token, before generate
spend      ->  max 4 x402 calls x $0.001 = $0.004     (X402_UNIT_COST_USD)
```

Every thread self-funds its own settles with ~6x headroom, and `/api/generate/
stream` only opens after `verifyPayment` confirms the pay tx — so the credit is
always on-chain first.

**Therefore this spec deliberately does NOT check AgentWallet's token balance.**
Mainnet cUSD balance is currently `0`; a naive `balance >= cost` preflight would
block 100% of cUSD payments today, even though those threads succeed. The
correct predicate, if one is ever wanted, is `balance + agentShare >= maxSpend`
— not `balance >= maxSpend`. Checking the balance here is not merely redundant,
it is wrong.

## Goal & success criteria

Block the payment *before the wallet sheet opens* whenever a settle provably
cannot happen, and tell the user why.

- **Success:** with AgentWallet paused (or the orchestrator EOA out of gas),
  tapping unlock shows an explanation and `pay()` is never called — the user's
  wallet is never asked to sign, and no `threads` row is created.
- **Non-goal:** changing any post-payment behaviour. The refundable-failure
  path stays exactly as documented in `.claude/docs/generate-flow.md`.

## What can still take money and then fail

Read from Celo mainnet on 2026-07-27 (`AgentWallet 0x006cBA30…`):

| Condition | State today | Guarded? |
|---|---|---|
| Orchestrator EOA out of native CELO (gas) | 0.4552 CELO | **No** — `walletHealth.ts` counts ERC-20 only |
| `AgentWallet.paused()` | `false` | **No** |
| `CAP_EXCEEDED` (daily cap per token) | caps set $10 on all 3 tokens; ~2,500 threads/day to hit | No, but not realistic |
| AgentWallet token balance | cUSD 0 · USDT 3.047 · USDC 5.722 | N/A — see above |

Gas is the real gap and the one most likely to bite under real traffic.

## Design

### 1. `lib/agent/walletHealth.ts` — new `checkSpendReadiness`

```ts
export type SpendReadiness =
  | { ok: true }
  | { ok: false; reason: 'paused' | 'gas' | 'cap' };

export function checkSpendReadiness(params: {
  chainId: number;
  tokenSymbol: TokenSymbol;
  minGasCelo?: number;
  readers?: ReadinessReaders;   // injected in tests, no RPC touched
}): Promise<SpendReadiness>;
```

Three read-only checks, in order (first failure wins, so the user gets the most
actionable reason):

1. `AgentWallet.paused()` -> `paused`
2. native balance of `AgentWallet.owner()` below `minGasCelo` -> `gas`
3. `dailySpendCap[token] - spentOnDay[currentDay()][token] < 4 x unitCost` -> `cap`

The orchestrator address comes from the on-chain `owner()` call, **not** from
`AGENT_WALLET_PRIVATE_KEY`. The preflight never touches a private key.

Lives alongside the existing `checkAgentWalletBalance` / `checkReserveBalance`
and reuses their injected-reader pattern, so no new module is introduced.

### 2. `app/api/preflight/route.ts`

`GET /api/preflight?token=cUSD|USDT|USDC` -> `200 { ok: true }` or
`200 { ok: false, reason }`. Unknown token -> `400`.

- Not-ready is `200`, not an error status: it is a valid answer to a valid
  question, and a non-2xx would be indistinguishable from the outage case.
- In-process cache, 30s TTL, keyed by token. These values change slowly and the
  route is public; this keeps preview screens from hammering the RPC.

**Fail-open.** If the RPC read itself throws or times out, return
`{ ok: true }`. The preflight is a guard, not a gate of record — the backstop
remains the invariant that every failure is clean and refundable. A preflight
bug or an RPC blip must never freeze all revenue. (Precedent: the Upstash
fail-closed outage silently killed free preview.)

### 3. Client — `HomeClient.unlock()`

`unlock()` (app/HomeClient.tsx:481) is the only path to `pay()`, including the
`preview-unavailable` branch. It calls the preflight first; on `ok: false` it
routes to a new `spend-unavailable` screen rendered by `ErrorSurface.tsx` and
returns without calling `pay()`. Copy per reason:

| reason | copy |
|---|---|
| `paused` | The agent is paused for maintenance. You have not been charged. |
| `gas` | The agent can't post transactions right now. You have not been charged. |
| `cap` | The agent hit its daily spending limit. Try again tomorrow — you have not been charged. |

Each states plainly that no charge occurred, because the user tapped a button
that normally costs money.

### 4. `app/api/cron/reconcile/route.ts` — alert on gas

Add the orchestrator gas balance to the existing heartbeat so ops is paged
while there is still time to top up, rather than learning from blocked users.

## Testing

- `walletHealth.test.ts`: readiness truth table (`ok`, `paused`, `gas`, `cap`)
  via injected readers; asserts precedence when several conditions fail at once.
- `app/api/preflight/route.test.ts`: ready/not-ready shapes, bad token -> 400,
  reader throws -> fail-open `{ ok: true }`, cache serves a second call without
  a second read.
- `HomeClient`: `unlock()` with a not-ready preflight never calls `pay()`.
- Cron route test extended for the gas alert.

## Rejected alternatives

- **B — gate server-side at the top of `/api/generate/stream`, after
  `verifyPayment`.** Easiest to test, but too late by construction: the money is
  already taken. It converts a dirty failure into a clean refundable one, which
  the existing invariants already do. It does not meet the goal.
- **C — alert-only: add gas to the cron heartbeat and stop there.** Cheapest,
  and it is included here as part 4, but on its own it only shortens the window
  — users can still pay into a wallet that cannot settle.
