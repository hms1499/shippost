# CoinOp

> Formerly **ShipPost** — the on-chain contract keeps the historical name `ShipPostPayment`.

> Pay $0.05. Get a ready-to-post X thread. No subscription, no prompt engineering.

CoinOp is a pay-per-use AI thread writer running as a MiniApp inside Opera's MiniPay wallet. Each thread costs $0.05 in cUSD, USDT, or USDC. An ERC-8004 agent wallet makes 1–4 micro-payments (x402) to AI services (Groq, Serper, CoinGecko) to generate a ready-to-post X thread, streamed live with cost transparency.

**Proof of Ship — MiniPay MiniApp (AI Agents) category** · live on Celo mainnet

---

## How it works

1. User opens CoinOp inside MiniPay on Android — the wallet auto-connects
2. Picks one of four modes and enters a topic (Daily Recap needs no input at all)
3. Reads the opening tweet as a **free sample** before paying anything
4. Approves a one-time $0.05 stablecoin payment via `payForThread` to unlock the full thread
5. The agent wallet makes x402 micro-payments to AI services, streamed live as a trace log
6. The thread arrives editable and shareable to X, closed by a printed **receipt** of the agent's per-call on-chain spend

### Modes

| Mode | Steps | Agent spend |
|------|-------|-------------|
| **I — Hot Take** | Serper search → CoinGecko market → Groq draft → fact-check | ~$0.003 |
| **II — Educational** | Serper (soft grounding) → Groq draft | ~$0.001 |
| **III — Token Analysis** | Serper → CoinGecko + DefiLlama TVL → Groq draft → fact-check | ~$0.003 |
| **IV — Daily Recap** | Serper headlines → CoinGecko market overview + DefiLlama → Groq draft → fact-check | ~$0.003 |

---

## Deployed contracts

### Celo Mainnet (chainId 42220)

| Contract | Address |
|----------|---------|
| ShipPostPayment | [`0xfe9a248ea318ef0169cb542e299b183748009b81`](https://celo.blockscout.com/address/0xfe9a248ea318ef0169cb542e299b183748009b81#code) |
| AgentWallet | [`0x006cba3012139c299aa4a522697b4a0c49f38895`](https://celo.blockscout.com/address/0x006cba3012139c299aa4a522697b4a0c49f38895#code) |

### Celo Sepolia Testnet (chainId 11142220)

| Contract | Address |
|----------|---------|
| ShipPostPayment | [`0x277e140933d600cafcad38e2f1018e4fbd5476b2`](https://celo-sepolia.blockscout.com/address/0x277e140933d600cafcad38e2f1018e4fbd5476b2) |
| AgentWallet | [`0x7538627c5eef2193fa4960f03157f482eca333be`](https://celo-sepolia.blockscout.com/address/0x7538627c5eef2193fa4960f03157f482eca333be) |

---

## Architecture

### Two-layer model

CoinOp spans **two chains on purpose** — each is a separate layer with one chain,
not a "multi-chain" app. The mental model is one sentence: **users pay on Celo; the
agent pays AI services via x402 on Base.**

```
┌────────────────────────────────────────────────────────────────────────┐
│  LAYER 1 · Payment          chain: Celo (42220)   token: cUSD/USDT/USDC  │
│  why this chain: MiniPay lives on Celo                                   │
│                                                                          │
│   User (MiniPay)  ──$0.05──►  ShipPostPayment.sol                        │
│                                  └─ split 50 / 40 / 10                    │
│                                     → AgentWallet · treasury · reserve    │
└────────────────────────────────────────────────────────────────────────┘
                         │  thread request (payment verified on-chain)
                         ▼
               /api/generate/stream   ·   pipeline orchestrator
                         │  agent pays per AI call
                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│  LAYER 2 · Agent x402 spend  chain: Base (8453)    token: USDC           │
│  why this chain: x402's home turf — Coinbase CDP facilitator             │
│                                                                          │
│   Agent EOA  ──sign EIP-3009──►  /api/x402/groq                          │
│                                     └─ CDP facilitator verifies + settles │
│                                        → 0.001 USDC → treasury  (gasless) │
└────────────────────────────────────────────────────────────────────────┘
```

The two layers are independent: which chain the user paid on does **not** dictate
where the agent settles its AI spend. Config reflects this split —
`lib/chains.ts` / `tokens.ts` / `contracts.ts` are Celo-only (Layer 1);
`lib/x402/config.ts` is Base-only (Layer 2).

> **Current state (honest):** Layer 2 is **proven live on Base mainnet**
> ([tx `0x7b71d5f7…92db1`](https://basescan.org/tx/0x7b71d5f74b832abab6c807ba0daccadbf62d4ca4dc5fda80c059bb14e3b92db1),
> see [docs/x402-mainnet-proof.md](docs/x402-mainnet-proof.md)). Production MiniPay
> threads still settle on Celo via the legacy path; routing every thread through
> Layer 2 (decoupling the settle decision from the payment chain) is a tracked
> next step, not a flag flip.

### Component view

```
MiniPay (Android)
    └─ CoinOp frontend (Next.js 14, App Router)
           ├─ ShipPostPayment.sol  ← pulls $0.05, splits 50/40/10 to agent/treasury/reserve
           ├─ AgentWallet.sol      ← ERC-8004, $10/day spend cap, executes x402 calls
           └─ /api/generate/stream (SSE)
                  └─ in-process pipeline: serper · coingecko · defillama · groq ·
                     fact-check — each settles via AgentWallet (Model 1, no HTTP route)
```

### On-chain

- **`ShipPostPayment.sol`** — `payForThread(token, mode)` pulls exactly $0.05, splits to three addresses, emits `ThreadRequested`. Token whitelist enforced. Decimal-safe via `IERC20Metadata(token).decimals()`.
- **`AgentWallet.sol`** — ERC-8004 compatible. Owner is the orchestrator EOA. `executeX402Call` enforces the $10/day spend cap per token and emits `X402PaymentMade`.

### x402 settlement — two models

**Model 1 — per-thread generate (Celo).** Groq, Serper, and CoinGecko don't support x402 natively, so each pipeline step *simulates* x402 in-process by pulling stablecoin from AgentWallet via `settleX402Call`. There are **no public `/api/x402/*` proxy routes** for these — the earlier unauthenticated proxies were removed in `8f4c222` (free-drain risk).

**Model 2 — `/api/x402/groq` (Base).** A genuine x402 endpoint: the *caller* pays *us* in USDC through the Coinbase CDP facilitator, settling to the treasury. It does **not** touch AgentWallet. Proven live on Base mainnet ([tx `0x7b71d5f7…92db1`](https://basescan.org/tx/0x7b71d5f74b832abab6c807ba0daccadbf62d4ca4dc5fda80c059bb14e3b92db1)). See [docs/x402-mainnet-proof.md](docs/x402-mainnet-proof.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §2.3.

### Pipeline

`lib/pipeline/` — step abstraction used by the SSE endpoint. Each step fires one x402 call and emits a `PipelineEvent` with `{ step, status, cost }` streamed to the `useThreadGeneration` hook.

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14 (App Router), React 18, Framer Motion, Tailwind CSS |
| Wallet | wagmi v2, viem, RainbowKit (MiniPay auto-connect via injected provider) |
| Contracts | Solidity 0.8.24, Hardhat, hardhat-toolbox-viem |
| AI | Groq (llama-3.3-70b), Serper, CoinGecko |
| Database | Supabase (server-side only: threads, refund queue, funnel events) |
| Chain | Celo mainnet + Celo Sepolia testnet |

---

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill in required vars (see below)
pnpm dev
```

Open `http://localhost:3000`. MiniPay auto-connects when running inside the wallet; on desktop, use RainbowKit to connect a browser wallet on Celo network.

---

## Environment variables

Copy `.env.example` to `.env.local` and fill in:

| Variable | Required | Description |
|----------|----------|-------------|
| `DEPLOYER_PRIVATE_KEY` | Deploy only | Deployer EOA private key |
| `AGENT_WALLET_PRIVATE_KEY` | Server | Orchestrator EOA — owns AgentWallet, signs x402 settlements |
| `GROQ_API_KEY` | Server | Groq API key (free tier works) |
| `SERPER_API_KEY` | Server | Serper.dev key (2,500 free queries) |
| `COINGECKO_API_KEY` | Optional | CoinGecko Demo key (falls back to public endpoint) |
| `NEXT_PUBLIC_SUPABASE_URL` | Server | Supabase project URL |
| `SUPABASE_SERVICE_ROLE` | Server | Supabase service role key |
| `REFUND_ADMIN_KEY` | Server | Random hex for `/api/refund` gate (`openssl rand -hex 24`) |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional | Reown project ID (not needed for MiniPay) |
| `NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET` | Frontend | ShipPostPayment mainnet address |
| `NEXT_PUBLIC_AGENT_WALLET_MAINNET` | Frontend | AgentWallet mainnet address |
| `NEXT_PUBLIC_PAYMENT_CONTRACT_TESTNET` | Testnet builds | ShipPostPayment on Celo Sepolia |
| `NEXT_PUBLIC_AGENT_WALLET_TESTNET` | Testnet builds | AgentWallet on Celo Sepolia |
| `NEXT_PUBLIC_TARGET_CHAIN_ID` | Frontend | `42220` (default) or `11142220` — which chain the build targets |
| `NEXT_PUBLIC_APP_URL` | Optional | Canonical app URL for metadata/share links |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | Model 2 only | Coinbase CDP facilitator creds for `/api/x402/groq` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Server | Rate limiting (free preview + public APIs) |
| `PREVIEW_DAILY_CAP` | Optional | Per-IP daily cap on free previews |

Mainnet contract addresses are already filled in `.env.example` after deployment.

---

## Commands

```bash
# Development
pnpm dev                    # Next.js dev server
pnpm build                  # Production build
pnpm lint                   # ESLint

# Contracts
pnpm compile                # Compile Solidity
pnpm test:contracts         # Hardhat tests (17 tests)
pnpm test:lib               # Vitest unit tests over lib/ and app/
pnpm deploy:testnet         # Deploy to Celo Sepolia

# Mainnet deploy
npx hardhat run scripts/deploy-mainnet.ts --network celo

# Operations
pnpm refund:list            # List queued refund requests
pnpm refund:process <id>    # Settle one queued refund (REFUND_ADMIN_KEY)
pnpm refund                 # Legacy one-off admin refund CLI
pnpm hardhat run scripts/pause.ts --network celo    # Emergency pause
pnpm analyze                # Bundle size analysis
```

---

## Project structure

```
app/
  api/
    generate/stream/     # SSE endpoint — verifies payment on-chain, runs pipeline
    preview/             # free first-tweet sample (rate-limited)
    x402/groq/           # Model 2: real x402 endpoint we SELL (Base, CDP facilitator)
    refund-request/      # self-service refund queue
    public/              # stats, funnel ingest, threads public API
  history/               # per-wallet thread history
  stats/                 # public analytics page
  HomeClient.tsx         # main app UI (mode → free sample → pay → generate → receipt)
components/
  AgentTrace.tsx         # live trace log with x402 cost per step
  ThreadPreview.tsx      # tweet cards with inline edit
  ShareToX.tsx           # twitter:// deep link + web fallback
  PostShareScreen.tsx    # printed receipt: split + per-call x402 spend, tx links
  ErrorSurface.tsx       # error states (insufficient / cap-hit / paused / …)
contracts/
  AgentWallet.sol
  ShipPostPayment.sol
lib/
  pipeline/              # step abstraction (groqStep, serperStep, coingeckoStep, …)
  prompts/               # LLM prompt templates
  chains.ts              # getChain / explorerBase / isSupportedChain
  contracts.ts           # ABI + addresses for both chains
  tokens.ts              # token configs (mainnet + testnet)
  wagmi.ts               # wagmi config
scripts/
  deploy.ts              # testnet deploy (mock tokens)
  deploy-mainnet.ts      # mainnet deploy (real tokens, $10/day cap)
  pause.ts               # emergency pause/unpause
  refund.ts              # admin refund
deployments/
  celo.json              # mainnet deployment record
  celoSepolia.json       # testnet deployment record
supabase/
  migrations/            # schema (threads, refund_requests, funnel_events)
```

---

## Safety

- **Pausable** — both contracts have an owner-only kill switch (`pause()` / `unpause()`)
- **Daily spend cap** — AgentWallet enforces $10/day per token; resets at UTC midnight
- **Token whitelist** — only cUSD, USDT, USDC accepted by ShipPostPayment
- **Decimal-safe** — all token math uses `IERC20Metadata(token).decimals()`, never hardcoded
