# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**ShipPost** — pay-per-use AI thread writer running as a MiniApp inside Opera's MiniPay wallet. Users pay $0.05 cUSD/USDT/USDC per thread. An ERC-8004 agent wallet makes 3-5 x402 micro-payments to AI services (Groq, fal.ai, Serper) to generate a ready-to-post X thread.

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
```

Run a single Hardhat test file:
```bash
npx hardhat test test/ShipPostPayment.t.ts
```

## Architecture

### On-chain (contracts/)

Two contracts, both deployed on Celo Sepolia testnet (Week 1) and Celo mainnet (Week 2+). Note: Alfajores has been deprecated by Celo — use Celo Sepolia (chainId 11142220) for testnet.

- **`ShipPostPayment.sol`** — payment splitter. `payForThread(address token, uint8 mode)` pulls 0.05 stablecoin from user, splits 50% → AgentWallet / 40% → treasury / 10% → reserve, emits `ThreadRequested`. Token whitelist only (cUSD/USDT/USDC). Decimal handling: `IERC20Metadata(token).decimals()` — cUSD=18, USDT=6, USDC=6.
- **`AgentWallet.sol`** — ERC-8004 compatible. Holds stablecoins for x402 spending. Single owner (orchestrator backend EOA), daily spend cap per token (cUSD=$50, USDT/USDC=$50 equiv). `executeX402Call` enforces the cap and emits `X402PaymentMade`.

### x402 Proxy (app/api/x402/)

Custom Next.js API routes — Groq, fal.ai, Serper, CoinGecko don't support x402 natively. Each route:
1. Verifies `X-Payment` header (EIP-712 signed payment intent from agent wallet)
2. Forwards to the real AI API using our backend API keys
3. Settles by pulling stablecoin from AgentWallet

Routes: `/api/x402/groq`, `/api/x402/flux`, `/api/x402/serper`, `/api/x402/coingecko`, `/api/x402/fact-check`

### Pipeline (lib/pipeline/)

Step abstraction used by the SSE endpoint `/api/generate/stream`. Each step is a function returning a `PipelineStep` that fires an x402 call and emits a `PipelineEvent` with `{ step, status, cost }`.

- **Mode A (Educational):** `groqStep` → `fluxStep`
- **Mode B (Hot Take):** `serperStep` → `coingeckoStep` → `groqStep` → `factCheckStep` → `fluxStep`

`runModeA.ts` / `runModeB.ts` compose steps and stream SSE events to the `useThreadGeneration` hook on the client.

### Frontend (app/ + components/ + hooks/)

Next.js 14 App Router, mobile-only (MiniPay webview). **Dark mode default.** Bundle budget: <200KB gzipped on `/`.

Key flow:
1. `lib/minipay.ts` — detects `window.ethereum.isMiniPay`, auto-connects via injected provider (no WalletConnect)
2. `lib/useBalances.ts` — reads cUSD/USDT/USDC balances, defaults to highest
3. `lib/usePayForThread.ts` — sends `payForThread` tx via wagmi
4. `hooks/useThreadGeneration.ts` — SSE consumer, typed state machine driving the UI
5. `components/GeneratingStatus.tsx` — progress theatre with live x402 cost per step + Celoscan link
6. `components/ThreadPreview.tsx` — tweet cards with inline edit, thumbnail
7. `components/ShareToX.tsx` — `twitter://post` deep link, web fallback

### Data (Supabase)

Server-side only. Schema in `supabase/migrations/0001_threads.sql`. Stores wallet address + thread metadata (no PII). History and analytics pages read via edge-runtime API routes (`/api/public/analytics`, `/api/public/threads`, `/app/history`, `/app/stats`).

### Chain config (lib/)

- `lib/chains.ts` — `getChain(chainId)`, `explorerBase(chainId)`, `isSupportedChain(chainId)` for Celoscan / Blockscout links
- `lib/wagmi.ts` — Celo mainnet (42220) + Celo Sepolia testnet (11142220) connectors
- `lib/tokens.ts` — token addresses + decimals for both chains
- `lib/contracts.ts` — ShipPostPayment + AgentWallet addresses for both chains

## Environment variables

See `.env.example`. Key vars:
- `AGENT_WALLET_PRIVATE_KEY` — orchestrator EOA, stored encrypted in Vercel
- `GROQ_API_KEY`, `FAL_KEY`, `SERPER_API_KEY`
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
