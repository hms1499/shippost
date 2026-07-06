# AgentWallet Low-Balance Heartbeat — Design

**Date:** 2026-07-06
**Status:** Approved, ready for implementation
**Goal:** Catch a draining AgentWallet before it causes silent mass-failure. The agent settles `executeX402Call` in the same token the user paid; if that token's balance runs out, the (hard-fail) groq settle throws → every affected run fails → refundable, but silently and en masse. A heartbeat on the existing reconcile cron reads the agent wallet balance and pages a human while there is still time to top up. Recommendation #3, scoped to detection + throttled alert (per-request pre-flight guard deliberately excluded).

## Context

- `settleX402Call` (`lib/agent/orchestrator.ts`) spends from `getContracts(chainId).AgentWallet` in `getTokens(chainId)[tokenSymbol]` — the token the user paid. So low balance is **per-token**: the agent needs enough of each token users might pay with (cUSD 18-decimals, USDT/USDC 6-decimals).
- The deployed chain is `TARGET_CHAIN_ID` (`lib/targetChain.ts`, from `NEXT_PUBLIC_TARGET_CHAIN_ID`).
- The reconcile cron (`/api/cron/reconcile`, every 15 min) is the natural heartbeat host. `claimGenerationOnce` in `lib/rateLimit.ts` is the SET-NX pattern to mirror for alert throttling.

## Components

**1. `lib/agent/walletHealth.ts` — balance read, testable**
`checkAgentWalletBalance({ chainId, minUsd, readBalanceOf? })`:
- For each token (cUSD/USDT/USDC) on `chainId`: read `balanceOf(AgentWallet)`, format by `decimals` to a human number treated as ≈USD (all three are ~$1 pegged).
- Returns `{ low: TokenSymbol[], balances: Record<TokenSymbol, number> }`, where `low` lists tokens strictly below `minUsd`.
- `readBalanceOf(tokenAddress) => Promise<bigint>` is injectable for tests; the default builds a viem `publicClient` and calls `erc20 balanceOf`.

**2. `lib/rateLimit.ts` — `claimAlertOnce(key, ttlSec)`**
Mirrors `claimGenerationOnce`: Redis `SET key '1' NX EX ttlSec`. Returns `true` when this call claims the key (send the alert), `false` when the key already exists (suppress). **Fail-open**: when Redis is unset or throws, return `true` — over-alerting is safer than missing a low-balance page.

**3. `app/api/cron/reconcile/route.ts` — heartbeat step**
After `reconcileStuckThreads`, in its own try/catch (an RPC failure here must not fail the primary reconcile job):
- `const health = await checkAgentWalletBalance({ chainId: TARGET_CHAIN_ID, minUsd })`.
- If `health.low.length > 0` and `await claimAlertOnce('agent-wallet-low:' + TARGET_CHAIN_ID, 21600)` → one `alertOps('AgentWallet balance low', { chainId, low, balances })`.
- Catch → `console.error` (an RPC blip shouldn't page); the route still returns the reconcile summary (200).

## Throttle

Single key `agent-wallet-low:<chainId>`, TTL 6h (21600s, hardcoded const). At most one wallet-low alert per 6h while any token stays low; re-fires only after top-up + another dip past 6h. A newly-low second token within the window waits — acceptable for this traffic level.

## New env

- `AGENT_WALLET_MIN_BALANCE_USD` — threshold, default `2`. (Agent spends ~$0.017/run and the on-chain daily cap is $10; $2 leaves ~100 runs of runway.)

## Testing

- `walletHealth.test.ts` (injected `readBalanceOf`): `low` lists only tokens below the threshold; decimals formatted correctly (18 vs 6); `balances` map is complete.
- `rateLimit.test.ts`: `claimAlertOnce` claims first (SET NX returns OK → true), suppresses within TTL (null → false), fails open (`true`) when Redis env is missing and when the client throws.
- `app/api/cron/reconcile/route.test.ts` (mock `checkAgentWalletBalance` + `claimAlertOnce`): low tokens + claim `true` → wallet-low `alertOps` called; not low → not called; a thrown health check still returns 200 with the reconcile summary.

## Out of scope

- Per-request pre-flight balance guard in `/api/generate/stream` (settle-gates-delivery already makes an under-funded run cleanly refundable).
- Daily-cap headroom alert (deferred).
- Auto top-up / refill.
