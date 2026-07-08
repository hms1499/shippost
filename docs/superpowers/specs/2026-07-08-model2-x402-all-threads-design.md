# Model 2 — real x402 for every paid thread — Design

**Date:** 2026-07-08
**Status:** Approved, ready for implementation
**Goal:** Make the competition claim literally true: every paid thread's Groq settlement is a real x402 payment (agent signs EIP-3009 `X-Payment`, Coinbase CDP facilitator verifies and settles USDC on Base, verifiable on Basescan). Today `getSettleMode(ctx.chainId)` keys the settle path off the **payment** chain, and MiniPay users only pay on Celo, so 100% of production threads settle via the simulated Model 1 push-to-sink. This decouples the two: the user keeps paying on Celo; the agent's own $0.001 Groq spend settles on Base.

**What this feature does NOT do (stated during brainstorm):** it brings no users, no revenue, no thread-quality change. It exists to close the "your agent doesn't actually speak x402" hole in the Proof of Ship (AI Agents track) story, and to have the agent already speaking the real protocol for when AI providers accept x402 natively.

## Current state (what already exists)

- `app/api/x402/groq/route.ts` — real x402 resource server (`withX402`, verify-before-handler, settle-only-after-200). Proven on Base mainnet 2026-06-03 (`docs/x402-mainnet-proof.md`).
- `lib/x402/client.ts` `payGroqViaX402` — agent EOA signs the `X-Payment`, pays our proxy through `@x402/fetch`. CDP request-scoped JWT auth solved (`lib/x402/server.ts`).
- Guards: Redis daily cap (`reserveDailySpend`), pause switch (`X402_PAUSED` env or `x402:paused` Redis key), small hot float in the agent EOA.
- `lib/pipeline/generateDraft.ts` already branches on `getSettleMode(...)`; the x402 branch is production-dead only because the mode is keyed on the payment chain.

## 1. Settle routing (`lib/x402/config.ts`, `lib/pipeline/generateDraft.ts`)

- `getSettleMode()` **drops its `chainId` parameter**. Returns `'x402'` iff `X402_SETTLE_MODE === 'x402'` **and** `X402_CHAIN_ID` parses to a supported chain (8453 / 84532); anything else → `'legacy'`. Fail-safe: a bad or missing `X402_CHAIN_ID` degrades to legacy, never throws at import time.
- New `getSettleChainId(): number` — the parsed `X402_CHAIN_ID`. Only meaningful when mode is `'x402'`.
- `generateDraft` x402 branch calls `payGroqViaX402({ chainId: getSettleChainId(), … })`. `ctx.chainId` (the payment chain) is no longer consulted for settle-mode.
- Untouched: free preview (`generateTweets`, no settle), Serper/CoinGecko/FactCheck steps (stay Model 1 on the payment chain — scope decision below).

## 2. Fallback — x402-first, legacy on infra failure

In `generateDraft`, wrap the x402 branch in try/catch:

- **Abort/deadline errors → rethrow unchanged.** Invariant: a run that is already `fatal`/refundable never settles anything (matches the existing `throwIfAborted` contract). Detection: `signal.aborted` is set, or the error is the `'aborted: generation deadline exceeded'` path from `lib/x402/client.ts`.
- **Every other error** (CDP down, daily cap hit, paused, empty float, proxy 5xx, network) → fire-and-forget `alertOps('x402 settle fell back to legacy', { threadId, error })`, then run the existing legacy branch (`generateTweets` + `settleX402Call` on the payment chain). The user always gets their thread.
- Consequence worth naming: the `x402:paused` Redis kill-switch now means "degrade gracefully to legacy", not "threads fail" — an instant, no-deploy rollback lever.
- **Accepted edge (no dedup built):** if the proxy settled (returned 200) but the response is lost/corrupted on the way back, the client throws and the fallback settles again via legacy. Max exposure ≈ $0.002 per occurrence (0.001 USDC + 0.001 cUSD-equivalent), rare; accepted during brainstorm.

## 3. Event + UI — per-row explorer links

- `PipelineEvent` `step_settled` gains optional `chainId?: number`. The x402 branch emits `getSettleChainId()`; the legacy branch emits nothing (falls back to the payment chain downstream).
- `DraftResult` carries the settle chainId so `groqStep` (Mode A) and `runModeB`'s direct `generateDraft` call emit it consistently.
- `components/AgentTrace.tsx`: each `LogRow` resolves its explorer as `explorerBase(row.chainId ?? paymentChainId)` (`lib/chains.ts` — add Base entries if missing). The Groq settle row links to Basescan; payment + other steps keep Celoscan.
- `hooks/useThreadGeneration.ts` passes the field through untouched. During implementation, audit receipt surfaces (`lib/receiptText.ts`, `PostShareScreen`) — anywhere a settle tx is rendered gets the same per-row treatment; the payment tx is Celo always.
- Supabase `threads` rows: `txByStep` persistence in `/api/generate/stream` is unchanged (hashes are stored without chain today; the UI/receipt is the only place links are built).

## 4. Ops rollout (ordered; steps 2–3 are the user's)

1. Ship the code with `X402_SETTLE_MODE` unset in prod — everything stays legacy, zero risk.
2. **User:** top up the agent EOA `0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78` with ~$2 USDC on Base mainnet (≈2000 threads of float; hot-float-small philosophy unchanged).
3. **User provides / confirms** prod env values; set via **Vercel REST API upsert** (CLI stdin on v54 stores `""` — known issue): `X402_SETTLE_MODE=x402`, `X402_CHAIN_ID=8453`, `X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402`, `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, `X402_PAY_TO=<treasury>`, `X402_PROXY_BASE_URL=https://shippost.app`, `X402_DAILY_CAP_USDC` (default 5).
4. Smoke against prod proxy: `scripts/x402-smoke.ts --expect=success` (spends 0.001 USDC), then flip the flag, then **one real paid thread from the funded test wallet on-device** — verify: Celoscan payment tx, Basescan settle tx, AgentTrace links resolve per-row, Supabase row sane.
5. Rollback: set `X402_SETTLE_MODE=legacy` (redeploy) or `redis set x402:paused 1` (instant, no deploy, falls back per §2).
6. Docs: update `.claude/docs/x402.md`, `docs/ARCHITECTURE.md` §2.3, and `docs/x402-mainnet-proof.md` (replace the "Next step — Model 2" section with live status).

## 5. Testing (Vitest, existing suites)

- `lib/x402/config.test.ts` — rewrite for the new signatures: flag on + valid chain → x402; flag on + missing/garbage `X402_CHAIN_ID` → legacy; flag off → legacy; `getSettleChainId` parsing.
- `lib/pipeline/generateDraft.test.ts` — (a) x402 infra error → legacy path runs, `alertOps` called, tweets delivered; (b) abort mid-x402 → rethrow, legacy settle **not** called; (c) x402 success → `settleX402Call` never touched, result carries the Base chainId; (d) legacy mode → unchanged behavior.
- UI: repo has no component-test harness; AgentTrace per-row explorer selection is covered by extracting the `chainId → explorer` resolution into `lib/chains.ts` (unit-testable) and by the on-device verification run in §4.

## Decisions taken during brainstorm

- **Scope: Groq only.** Serper/CoinGecko/FactCheck stay Model 1. Groq is the one step that runs in both modes, so "every paid thread has ≥1 real x402 settlement" holds with the smallest surface. Extending FactCheck (also a Groq call) is a natural later increment.
- **Fallback over hard-fail.** A CDP/Base outage must never cost a paid user their thread. The honest claim becomes "x402-first with audited legacy fallback"; every fallback fires a Discord alert so silent drift is visible.
- **Approach A over alternatives:** (B) plumbing a `settleChainId` through `PipelineContext` adds surface without value while the flag is env-global; (C) in-process facilitator calls without the HTTP 402 round-trip re-implements `@x402/fetch` and weakens the "curl it and see the 402" story.

## Out of scope

- x402 for Serper/CoinGecko/FactCheck steps.
- Any change to the user payment flow, `ShipPostPayment`, refunds, or MiniPay/Celo chain handling.
- Automated float top-up or bridging; float is manual and monitored via the existing alert when `payGroqViaX402` starts failing (which now also falls back safely).
- Removing the legacy path.
