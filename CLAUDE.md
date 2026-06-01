# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**ShipPost** — pay-per-use AI thread writer running as a MiniApp inside Opera's MiniPay wallet. Users pay $0.05 cUSD/USDT/USDC per thread. An ERC-8004 agent wallet makes 1–4 x402 micro-payments to AI services (Groq, Serper, CoinGecko) to generate a ready-to-post X thread. (Flux thumbnail step was scrapped 2026-05-01 — content-only.)

Competition: Proof of Ship — MiniPay MiniApp (AI Agents) category.

## Commands

```bash
pnpm dev                                            # dev server
pnpm build                                          # production build
pnpm lint                                           # ESLint via next lint
pnpm test:contracts                                 # Hardhat tests
pnpm compile                                        # compile Solidity
pnpm deploy:testnet                                 # deploy to Celo Sepolia (chainId 11142220)
hardhat run scripts/deploy.ts --network celo        # deploy to Celo mainnet (chainId 42220)
pnpm refund:list                                    # admin: list pending refund_requests rows
pnpm refund:process <requestId> [--amount=0.02]     # admin: settle one queued refund (REFUND_ADMIN_KEY required)
```

Run a single Hardhat test file:
```bash
npx hardhat test test/contracts/ShipPostPayment.t.ts
```

## Architecture

### On-chain (contracts/)

Two contracts, both deployed on Celo Sepolia testnet (Week 1) and Celo mainnet (Week 2+). Note: Alfajores has been deprecated by Celo — use Celo Sepolia (chainId 11142220) for testnet.

- **`ShipPostPayment.sol`** — payment splitter. `payForThread(address token, uint8 mode)` pulls 0.05 stablecoin from user, splits 50% → AgentWallet / 40% → treasury / 10% → reserve, emits `ThreadRequested`. Token whitelist only (cUSD/USDT/USDC). Decimal handling: `IERC20Metadata(token).decimals()` — cUSD=18, USDT=6, USDC=6.
- **`AgentWallet.sol`** — ERC-8004 compatible. Holds stablecoins for x402 spending. Single owner (orchestrator backend EOA), daily spend cap per token (cUSD=$50, USDT/USDC=$50 equiv). `executeX402Call` enforces the cap and emits `X402PaymentMade`.

### x402 settlement (in-process, via pipeline steps)

Groq, Serper, CoinGecko don't support x402 natively, so each pipeline step
(lib/pipeline/*Step.ts) wraps the real API call and settles by pulling
stablecoin from AgentWallet through `settleX402Call` (lib/agent/orchestrator.ts),
which calls `executeX402Call` (cap-enforced) on-chain.

Settlement runs **in-process** inside the SSE endpoint `/api/generate/stream` —
there are no standalone HTTP proxy routes. (Earlier `/api/x402/*` routes were
removed: the frontend never called them, they performed no `X-Payment`
verification, and exposing an unauthenticated endpoint that spends from
AgentWallet was a drain risk capped only by the daily limit.) If a public
agent-callable x402 surface is ever reintroduced, it MUST verify a signed
`X-Payment` intent before `settleX402Call`.

### Pipeline (lib/pipeline/)

Step abstraction used by the SSE endpoint `/api/generate/stream`. Each step is a function returning a `PipelineStep` that fires an x402 call and emits a `PipelineEvent` with `{ step, status, cost }`.

- **Mode A (Educational):** `groqStep`
- **Mode B (Hot Take):** `serperStep` → `coingeckoStep` → `groqStep` → `factCheckStep`

`runModeA.ts` / `runModeB.ts` compose steps and stream SSE events to the `useThreadGeneration` hook on the client.

### Generate-flow invariants (don't regress)

`/api/generate/stream` spends real cUSD per run, so the body is treated as hostile. Hard rules:

- **Payment is verified on-chain before any paid work.** `verifyPayment` (lib/agent/orchestrator.ts) decodes the `ThreadRequested` log from `payTxHash` and asserts threadId/payer/token/mode + `amount == requiredAmount`. The route rejects with 402 before opening the stream. Never trust `amountPaidRaw` or any body field — persist the verified amount.
- **One generation per payment.** The up-front `threads` insert runs *before* the stream; a unique-violation (23505) → 409, any other insert error → 503 fail-closed, both with zero x402 spend. Supabase-down is a documented degraded mode (serves, no replay guard), not a bug to "fix" by failing closed without discussion.
- **Settle gates delivery.** `step_output` (tweets) is emitted only *after* `settleX402Call` confirms, in both `groqStep` and `runModeB`. Never move the emit before settle — that reintroduces free-content-plus-refund.
- **Every failure is a clean, refundable state.** Output is `boundThread`-validated (empty/junk → throw before settle, no spend). Receipt waits are bounded (90s). A hung run hits the internal 150s deadline → `fatal` → thread `failed` → refundable, instead of a platform SIGKILL that leaves it stuck `pending`.
- **Retry, then escape hatch — never auto-refund.** Soft steps retry once (`retryOnce`, scoped to the external call only, never around settle). If still degraded, the preview surfaces a one-tap `kind=partial` refund request. Auto partial-refund was deliberately rejected (accounting complexity + amplifies the refund-funding caveat).
- **`X402_SINK_ADDRESS`** overrides the default 0x..dead burn sink; unset = burn (demo). The displayed cost derives from `GROQ_COST_CUSD` (single source) and cannot drift from what settles.

### Frontend (app/ + components/ + hooks/)

Next.js 14 App Router, mobile-only (MiniPay webview). **Dark mode default.** Bundle budget: <200KB gzipped on `/`.

Key flow:
1. `lib/minipay.ts` — detects `window.ethereum.isMiniPay`, auto-connects via injected provider (no WalletConnect)
2. `lib/useBalances.ts` — reads cUSD/USDT/USDC balances, defaults to highest
3. `lib/usePayForThread.ts` — sends `payForThread` tx via wagmi
4. `hooks/useThreadGeneration.ts` — SSE consumer, typed state machine driving the UI
5. `components/GeneratingStatus.tsx` — progress theatre with live x402 cost per step + Celoscan link
6. `components/ThreadPreview.tsx` — tweet cards with inline edit
7. `components/ShareToX.tsx` — `twitter://post` deep link, web fallback

### Data (Supabase)

Server-side only. Schema in `supabase/migrations/0001_threads.sql`. Stores wallet address + thread metadata (no PII). History and analytics pages read via edge-runtime API routes (`/api/public/analytics`, `/api/public/threads`, `/app/history`, `/app/stats`). All access uses the service role (`getSupabaseServer()`), which bypasses RLS — there is no anon client. `refund_requests` has RLS enabled with no permissive policy (0005): anon denied, service role unaffected.

### Refund operations (runbook)

Two settlement paths, both call `refundThread`: the admin HTTP endpoint `/api/refund` (one-off, `x-admin-key`) and the queue worker `pnpm refund:process <requestId>`. **Invariant: `threads.refund_tx_hash` is the single source of truth — once set, that thread is paid out and must never be sent again.** Both paths refuse when it's already set.

Key safety properties (don't regress these):
- **Refund amount is read on-chain** (`requiredAmount(token)` via `getOnChainPaidAmount`), never from `threads.amount_paid_raw` (client-supplied). Partials are capped at the on-chain paid amount.
- **The `refund_requests` lock is a compare-and-swap**: `refund:process` only proceeds if its conditional `pending → processing` UPDATE returned exactly one row. Concurrent runs are safe.
- **A failed send never auto-reverts to `pending`** — the tx may have broadcast. The row is left `processing` with the error in `rejection_reason`.

Recovering a row stuck in `processing` (send failed, on-chain state unknown):
1. Read `rejection_reason` on the `refund_requests` row.
2. Check the user's `wallet_address` on Celoscan for an inbound transfer of the refund token around `processed_at`.
3. If a transfer landed: set `status = completed`, set `refund_tx_hash` on **both** the `refund_requests` row and the parent `threads` row (the idempotency guard depends on the `threads` stamp).
4. If no transfer landed: fix the root cause (commonly the refund EOA out of funds — `refundThread` balance-checks and names the shortfall), then manually reset `status = pending` and re-run `pnpm refund:process <requestId>`.

Never reset to `pending` without confirming on-chain that no transfer landed — that is the double-refund path.

### Chain config (lib/)

- `lib/chains.ts` — `getChain(chainId)`, `explorerBase(chainId)`, `isSupportedChain(chainId)` for Celoscan / Blockscout links
- `lib/wagmi.ts` — Celo mainnet (42220) + Celo Sepolia testnet (11142220) connectors
- `lib/tokens.ts` — token addresses + decimals for both chains
- `lib/contracts.ts` — ShipPostPayment + AgentWallet addresses for both chains

## Environment variables

See `.env.example`. Key vars:
- `AGENT_WALLET_PRIVATE_KEY` — orchestrator EOA, stored encrypted in Vercel
- `GROQ_API_KEY`, `SERPER_API_KEY`
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`
- `NEXT_PUBLIC_*_MAINNET` — contract addresses exposed to client

## Plans

Implementation plans are in `docs/superpowers/plans/`. Always use `superpowers:executing-plans` or `superpowers:subagent-driven-development` skill when working from a plan file.

- Week 1: foundation + Celo Sepolia testnet end-to-end
- Week 2: Celo mainnet + Mode A + Supabase + progress theatre
- Week 3: Mode B (Hot Take) + history + analytics + error/refund flows

Design spec: `docs/superpowers/specs/2026-04-24-shippost-minipay-design.md`

## Key constraints

- **Mobile-only** — no desktop layout needed
- **Multi-token decimals** — always use `IERC20Metadata(token).decimals()` in contracts, never hardcode
- **x402 is custom** — no Coinbase CDP facilitator; all settlement goes through our proxy
- **Agent wallet daily cap** — $50/token; `executeX402Call` must enforce before calling external API
- **Contract Pausable** — kill-switch must remain intact; never remove `whenNotPaused`
