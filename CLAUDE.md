# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. It is a routing index — deep detail lives in `.claude/docs/`. Read the linked file before touching the matching domain.

## Project Overview

**CoinOp** (formerly ShipPost) — a coin-operated, pay-per-use AI thread writer. It runs on **Base** (USDC, gas sponsored via EIP-5792 + a CDP paymaster) and on **Celo** as a MiniApp inside Opera's MiniPay wallet (cUSD/USDT/USDC, user pays gas). Users pay **$0.10** per thread; an ERC-8004 agent wallet then makes 1–4 x402 micro-payments to AI services (Groq, Serper, CoinGecko) to generate a ready-to-post X thread. Content-only (the Flux thumbnail step was scrapped 2026-05-01). Competition: Proof of Ship — MiniPay MiniApp (AI Agents).

## Tech Stack

- **Next.js** 14 (App Router) / **React** 18 / **TypeScript** 6 — mobile-only (MiniPay webview), dark mode default
- **wagmi** 2.19 + **viem** 2.48 + **@tanstack/react-query** 5 — wallet/chain access (injected MiniPay provider; RainbowKit elsewhere). **Import EIP-5792 actions (`sendCalls`, `waitForCallsStatus`, `getCapabilities`) from `wagmi/actions`, never `@wagmi/core`** — two copies of `@wagmi/core` resolve here (wagmi 2.19 pins 2.22, `package.json` depends on 3.4) and `useConfig()` returns the 2.22 `Config`, so the direct import is a type error at every call site.
- **Hardhat** 3.4 + **@openzeppelin/contracts** 5.6 + `hardhat-viem` — Solidity contracts
- **@x402/{core,evm,fetch,next}** 2.14 + **@coinbase/cdp-sdk** 1.51 — x402 payments (two models — see docs)
- **@supabase/supabase-js** 2.105 — server-side persistence (service role only)
- **groq-sdk** 1.1 — LLM; **@upstash/{ratelimit,redis}** — rate limiting
- **Tailwind** 3.4 + Radix UI + framer-motion 12 + lucide-react — UI
- **Vitest** 4 (`lib`/`app`) + Hardhat tests (`test/contracts`); **pnpm** package manager

## Dev Commands

```bash
pnpm dev                       # dev server
pnpm build                     # production build (pnpm analyze for bundle report)
pnpm lint                      # ESLint via next lint
pnpm test:lib                  # Vitest over lib/ and app/
pnpm test:contracts            # Hardhat tests   (single file: npx hardhat test test/contracts/<file>.t.ts)
pnpm compile                   # compile Solidity
pnpm deploy:testnet            # deploy to Celo Sepolia (chainId 11142220)

# Deploy / configure a chain. DEPLOY_TARGET is base | baseSepolia | celo and is
# asserted against the connected chainId before anything is sent.
DEPLOY_TARGET=base npx hardhat run scripts/deploy-chain.ts --network base
# Re-apply post-deploy config idempotently — use this to recover a deploy that
# died partway, NEVER redeploy (that abandons live contracts + their counter).
DEPLOY_TARGET=base npx hardhat run scripts/configure-chain.ts --network base

pnpm refund:list               # admin: list pending refund_requests
pnpm refund:process <id>       # admin: settle one queued refund (REFUND_ADMIN_KEY required)
```

## Core Logic Summary

The paid generation flow (`/api/generate/stream`, SSE) is the heart of the app and spends real cUSD per run, so the request body is treated as hostile:

1. **Pay** — `ShipPostPayment.payForThread(token, mode, maxAmount)` pulls the current price ($0.10) and splits it 50% → AgentWallet / 40% → treasury / 10% → reserve, emitting `ThreadRequested`. `maxAmount` is the user's consent ceiling: the price is owner-settable, so without it a repricing between the read and the transaction would silently overcharge. Reverts `PRICE_EXCEEDS_MAX`.
2. **Verify** — the route decodes that log from `payTxHash` and asserts threadId/payer/token/mode + exact amount **before any paid work**.
3. **Generate** — a pipeline of steps fires 1–4 x402 micro-payments to AI services. Which steps run is declared per mode in `lib/pipeline/modes/` (**6 modes**, id 0–5, looked up by `getMode(body.mode)`); e.g. id 1 `hotTake` = `serperStep → coingeckoStep → groqStep → factCheckStep`. `ModeDef.id` is the on-chain `uint8` — **append-only, never renumber**.
4. **Settle gates delivery** — tweets are emitted only *after* the x402 settle confirms; every failure path is a clean, refundable state.

The non-negotiable invariants of this flow are in [`.claude/docs/generate-flow.md`](.claude/docs/generate-flow.md). Read it before editing anything under `/api/generate` or `lib/pipeline/`.

## Key Constraints

Never change or assume these without explicit sign-off:

- **Payment is verified on-chain before any spend.** Never trust `amountPaidRaw` or any body field; persist the verified amount. See `generate-flow.md`.
- **Settle gates delivery.** Never move a `step_output` emit before its `settleX402Call` — that reintroduces free-content-plus-refund.
- **Two unrelated x402 models — don't conflate them.** Model 1 (Celo, we *buy* services, custom/simulated through AgentWallet) vs Model 2 (`/api/x402/groq` + `/api/x402/data`, we *sell* a service, real x402 via a hosted facilitator — currently Celo mainnet `api.x402.celo.org` on prepaid credits, not Base/CDP). See [`.claude/docs/x402.md`](.claude/docs/x402.md). **Rule:** any public agent-callable x402 surface MUST verify a signed `X-Payment` before any spend, and must never expose `settleX402Call` unguarded.
- **`threads.refund_tx_hash` is the single source of truth for payouts** — once set, never send again. Refund amount is read on-chain, never from client-supplied fields. See [`.claude/docs/refunds.md`](.claude/docs/refunds.md).
- **Contracts:** keep the `Pausable` kill-switch (`whenNotPaused`) intact; enforce the AgentWallet $10/token/day (mainnet; $50 testnet) cap in `executeX402Call`; use `IERC20Metadata(token).decimals()` — never hardcode (cUSD=18, USDT/USDC=6); token whitelist only.
- **The price is on-chain and settable, so never compute it locally for a payment.** `readThreadPrice()` feeds the approve amount, the `maxAmount` ceiling and the displayed price from one read; `THREAD_PRICE_USD`/`THREAD_PRICE_LABEL` are display fallbacks only. Anything derived from a thread's *past* payment (refunds, volume) must come from that thread's own `ThreadRequested.amount`, never from `requiredAmount()` at head — see `refunds.md`.
- **`/api/paymaster` is deny-by-default, and gas sponsorship is never required.** The route proxies only `pm_getPaymasterStubData` / `pm_getPaymasterData`, only for a known chain/contract/selector, rate-limited — widen it and it becomes a public wallet. `CDP_PAYMASTER_URL` stays server-side, and unset is a supported state. Any wallet that can't answer `wallet_getCapabilities` (MiniPay included) must fall through to the plain EOA path, never error. See [`.claude/docs/architecture.md`](.claude/docs/architecture.md).
- **Multi-chain: `lib/chainPolicy.ts` is the only allowlist.** `isSupportedChain` is defined once, there; `lib/chains.ts` only says which chains *exist*. Never add a second source of truth for "supported" — that is how a chain gets accepted in one layer and rejected in another.
- **Deploy scripts must check `receipt.status`.** `waitForTransactionReceipt` resolves for reverted transactions too; a bare await once reported a reverted `setAllowedToken` as success and left Base live with no payable token. Read state back afterwards, with retries — a read straight after a write can hit a lagging load-balanced node.
- **Supabase is service-role only** (`getSupabaseServer()`, bypasses RLS); there is no anon client. No PII is stored.
- **Local-only:** `scripts/` and `tools/` are ops utilities, not deployed — keep them out of lint/CI/deploy scope.

## Additional Documentation

The full architecture walkthrough is the **canonical** source: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — progressive disclosure (Tầng 0→3), diagrams, glossary. The `.claude/docs/` files below are short agent rule-sets that point into it; read them before editing the matching code, and follow the `§` links for the *why*.

- [`.claude/docs/architecture.md`](.claude/docs/architecture.md) — routing map into `docs/ARCHITECTURE.md` by domain, plus contract invariants, chain config, and env quick-reference.
- [`.claude/docs/x402.md`](.claude/docs/x402.md) — the two x402 settlement models and the verify-before-spend rule (detail: §2.3).
- [`.claude/docs/generate-flow.md`](.claude/docs/generate-flow.md) — hostile-body invariants for `/api/generate/stream` (detail: §2.2, Tầng 3).
- [`.claude/docs/refunds.md`](.claude/docs/refunds.md) — refund safety properties + the recovery procedure for a row stuck in `processing` (detail: §2.6).
