# CoinOp

> Formerly **ShipPost** — the on-chain contract keeps the historical name `ShipPostPayment`.

> Pay $0.10. Get a ready-to-post X thread. No subscription, no prompt engineering.

CoinOp is a pay-per-use AI thread writer. It runs on **Base** (USDC, gas sponsored through a CDP paymaster for wallets that speak EIP-5792) and on **Celo**, where it is a MiniApp inside Opera's MiniPay wallet (cUSD, USDT, or USDC, user-paid gas). Each thread costs $0.10, read from the contract rather than hardcoded. An ERC-8004 agent wallet makes 1–4 micro-payments (x402) to AI services (Groq, Serper, CoinGecko) to generate a ready-to-post X thread, streamed live with cost transparency.

**Proof of Ship — MiniPay MiniApp (AI Agents) category** · live on Base mainnet and Celo mainnet

---

## How it works

1. User opens CoinOp — inside MiniPay on Android the wallet auto-connects; elsewhere they connect through RainbowKit
2. Picks one of four modes and enters a topic (Daily Recap needs no input at all)
3. Reads the opening tweet as a **free sample** before paying anything
4. Approves a one-time $0.10 stablecoin payment via `payForThread` to unlock the full thread. On Base a wallet that supports EIP-5792 sends approve+pay as one sponsored bundle and pays no gas; everything else falls back to two ordinary transactions
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

All deployed 2026-08-14 at $0.10/thread. Machine-readable records live in `deployments/`.

### Base Mainnet (chainId 8453)

USDC only. Gas is sponsored through a CDP paymaster for wallets that support EIP-5792; anything else pays its own gas.

| Contract | Address |
|----------|---------|
| ShipPostPayment | [`0x6915a137314e0588b671bc62e619cc4c3109a0b7`](https://basescan.org/address/0x6915a137314e0588b671bc62e619cc4c3109a0b7) |
| AgentWallet | [`0x1c88ee8a8d0133d80c15a3f69def4b258e2cc933`](https://basescan.org/address/0x1c88ee8a8d0133d80c15a3f69def4b258e2cc933) |

### Celo Mainnet (chainId 42220)

cUSD, USDT, USDC. This is the MiniPay surface; the user pays gas in the token they hold.

| Contract | Address |
|----------|---------|
| ShipPostPayment | [`0x921146fab0a60d48e1991495fc8a899d7c989f74`](https://celo.blockscout.com/address/0x921146fab0a60d48e1991495fc8a899d7c989f74) |
| AgentWallet | [`0x1eed568a18b89baf051c9294bcc8c5d579463444`](https://celo.blockscout.com/address/0x1eed568a18b89baf051c9294bcc8c5d579463444) |

Superseded: [`0x0dea3241…`](https://celo.blockscout.com/address/0x0dea32414e884253b51a43b19a6a8c6b8f3b1800#code) (v2, $0.05, 2-argument `payForThread`) and its AgentWallet [`0x006cba30…`](https://celo.blockscout.com/address/0x006cba3012139c299aa4a522697b4a0c49f38895#code). Left live rather than paused so any outstanding refund against it can still be honoured.

### Celo Sepolia Testnet (chainId 11142220)

| Contract | Address |
|----------|---------|
| ShipPostPayment | [`0x277e140933d600cafcad38e2f1018e4fbd5476b2`](https://celo-sepolia.blockscout.com/address/0x277e140933d600cafcad38e2f1018e4fbd5476b2) |
| AgentWallet | [`0x7538627c5eef2193fa4960f03157f482eca333be`](https://celo-sepolia.blockscout.com/address/0x7538627c5eef2193fa4960f03157f482eca333be) |

---

## Architecture

### Two-layer model

CoinOp has **two payment layers, and they are independent** — that is the whole
mental model. Layer 1 is the user paying us. Layer 2 is the agent paying for AI.
Neither dictates the other's chain: **which chain a user paid on does not decide
where the agent settles its AI spend**, and vice versa.

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LAYER 1 · Payment       chains: Base (8453) · Celo (42220)              │
│  a full contract pair deployed per chain — Base takes USDC,              │
│  Celo takes cUSD/USDT/USDC (it is where MiniPay lives)                   │
│                                                                          │
│   User  ──$0.10──►  ShipPostPayment.sol                                  │
│                        └─ split 50 / 40 / 10                             │
│                           → AgentWallet · treasury · reserve             │
│   on Base, EIP-5792 wallets send approve+pay as one sponsored bundle     │
└─────────────────────────────────────────────────────────────────────────┘
                         │  thread request (payment verified on-chain)
                         ▼
               /api/generate/stream   ·   pipeline orchestrator
                         │  agent pays per AI call
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  LAYER 2 · Agent x402 spend    chain: X402_CHAIN_ID    token: USDC       │
│  currently Celo 42220 (since 2026-08-04); Base 8453 still supported      │
│                                                                          │
│   Agent EOA  ──sign EIP-3009──►  /api/x402/groq                          │
│                                     └─ facilitator verifies + settles     │
│                                        → 0.001 USDC → treasury (gasless) │
└─────────────────────────────────────────────────────────────────────────┘
```

Config reflects the split. Layer 1 is `lib/chainPolicy.ts` (the allowlist — the
**only** place a chain is declared supported) over `lib/chains.ts` / `tokens.ts` /
`contracts.ts`. Layer 2 is `lib/x402/config.ts`, keyed by `X402_CHAIN_ID` and
carrying Base, Base Sepolia, Celo and Celo Sepolia.

> **Current state (honest):** Layer 2 is **proven live on Base mainnet**
> ([tx `0x7b71d5f7…92db1`](https://basescan.org/tx/0x7b71d5f74b832abab6c807ba0daccadbf62d4ca4dc5fda80c059bb14e3b92db1),
> see [docs/x402-mainnet-proof.md](docs/x402-mainnet-proof.md)) and has since moved
> to the Celo facilitator. Production threads still settle their AI spend via the
> legacy Model 1 path; routing every thread through Layer 2 is a tracked next step,
> not a flag flip.

### Component view

```
MiniPay (Android) · Base App / Coinbase Wallet · any browser wallet
    └─ CoinOp frontend (Next.js 14, App Router)
           ├─ ShipPostPayment.sol  ← pulls the on-chain price, splits 50/40/10 to
           │                          agent/treasury/reserve. One pair per chain
           ├─ AgentWallet.sol      ← ERC-8004, $10/day spend cap, executes x402 calls
           ├─ /api/paymaster       ← allowlisted proxy to the CDP paymaster (Base only)
           └─ /api/generate/stream (SSE)
                  └─ in-process pipeline: serper · coingecko · defillama · groq ·
                     fact-check — each settles via AgentWallet (Model 1, no HTTP route)
```

### On-chain

- **`ShipPostPayment.sol`** — `payForThread(token, mode, maxAmount)` pulls the current price, splits to three addresses, emits `ThreadRequested`. Token whitelist enforced. Decimal-safe via `IERC20Metadata(token).decimals()`. The price is `priceUsdCents` (state, `setPrice` is onlyOwner) rather than a literal, so repricing no longer means redeploying — and `maxAmount` is the caller's consent ceiling, without which an owner could reprice in the gap between a user reading the price and their transaction landing.
- **`AgentWallet.sol`** — ERC-8004 compatible. Owner is the orchestrator EOA. `executeX402Call` enforces the $10/day spend cap per token and emits `X402PaymentMade`.

### Gas sponsorship on Base

`usePayForThread` asks the wallet for its capabilities first. If it reports `paymasterService`, the approve and the `payForThread` go out as a single EIP-5792 `sendCalls` bundle with sponsorship attached — the user pays no gas and there is no gap between the two calls for an approve to fail into. Any wallet that cannot answer `wallet_getCapabilities` (MiniPay among them) is treated as a plain EOA and takes the two-transaction path unchanged.

The paymaster URL is a server secret, so the client talks to `/api/paymaster` instead. That route is **deny-by-default**: it forwards only `pm_getPaymasterStubData` and `pm_getPaymasterData`, only for a known chain, contract and selector, and it is rate-limited — because a caller can still ask us to sponsor a `payForThread` that reverts.

### x402 settlement — two models

**Model 1 — per-thread generate (we *buy*).** Groq, Serper, and CoinGecko don't support x402 natively, so each pipeline step *simulates* x402 in-process by pulling stablecoin from AgentWallet via `settleX402Call`, on the same chain the user paid on. There are **no public `/api/x402/*` proxy routes** for these — the earlier unauthenticated proxies were removed in `8f4c222` (free-drain risk).

**Model 2 — `/api/x402/groq` (we *sell*).** A genuine x402 endpoint: the *caller* pays *us* in USDC through a hosted facilitator, settling to the treasury. It does **not** touch AgentWallet, and its chain is `X402_CHAIN_ID`, independent of Layer 1. Proven live on Base mainnet ([tx `0x7b71d5f7…92db1`](https://basescan.org/tx/0x7b71d5f74b832abab6c807ba0daccadbf62d4ca4dc5fda80c059bb14e3b92db1)); now running on the Celo facilitator. See [docs/x402-mainnet-proof.md](docs/x402-mainnet-proof.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §2.3.

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
| Chains | Base mainnet + Celo mainnet; Base Sepolia + Celo Sepolia testnets |

---

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill in required vars (see below)
pnpm dev
```

Open `http://localhost:3000`. MiniPay auto-connects when running inside the wallet; on desktop, use RainbowKit to connect a browser wallet on any chain in `NEXT_PUBLIC_SUPPORTED_CHAIN_IDS` (Base and Celo by default).

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
| `NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET` | Frontend | ShipPostPayment on Celo mainnet |
| `NEXT_PUBLIC_AGENT_WALLET_MAINNET` | Frontend | AgentWallet on Celo mainnet |
| `NEXT_PUBLIC_PAYMENT_CONTRACT_BASE` | Frontend | ShipPostPayment on Base. No fallback — missing fails loudly |
| `NEXT_PUBLIC_AGENT_WALLET_BASE` | Frontend | AgentWallet on Base. No fallback |
| `NEXT_PUBLIC_PAYMENT_CONTRACT_TESTNET` | Testnet builds | ShipPostPayment on Celo Sepolia |
| `NEXT_PUBLIC_AGENT_WALLET_TESTNET` | Testnet builds | AgentWallet on Celo Sepolia |
| `NEXT_PUBLIC_SUPPORTED_CHAIN_IDS` | Frontend | Comma-separated allowlist, e.g. `8453,42220`. Unknown ids dropped |
| `NEXT_PUBLIC_DEFAULT_CHAIN_ID` | Frontend | Preferred chain. Loses to the allowlist if it is not in it |
| `CDP_PAYMASTER_URL` | Server, secret | Sponsors gas on Base. Proxied by `/api/paymaster`; unset → wallets pay their own gas |
| `ETHERSCAN_API_KEY` | Optional | Contract verification. One Etherscan V2 key covers Base |
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
pnpm test:contracts         # Hardhat tests (31 tests)
pnpm test:lib               # Vitest unit tests over lib/ and app/
pnpm deploy:testnet         # Deploy to Celo Sepolia

# Deploy a chain. DEPLOY_TARGET is base | baseSepolia | celo, and is asserted
# against the connected chainId before anything is sent.
DEPLOY_TARGET=base npx hardhat run scripts/deploy-chain.ts --network base

# Re-apply post-deploy config idempotently — this is how a deploy that died
# partway is recovered. Never redeploy for that; it abandons live contracts.
DEPLOY_TARGET=base npx hardhat run scripts/configure-chain.ts --network base

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
    x402/groq/           # Model 2: real x402 endpoint we SELL (chain = X402_CHAIN_ID)
    paymaster/           # allowlisted CDP paymaster proxy — keeps the URL server-side
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
  chains.ts              # which chains EXIST — getChain / explorerBase
  chainPolicy.ts         # which chains this deployment ACCEPTS — the only allowlist
  contracts.ts           # ABI + addresses, every chain
  tokens.ts              # token configs per chain (Partial — Base has no cUSD)
  threadPrice.ts         # readThreadPrice() — the authoritative, on-chain price
  payBundle.ts           # buildPayCalls() — the EIP-5792 approve+pay batch
  wagmi.ts               # wagmi config — every supported chain, default first
scripts/
  deploy.ts              # testnet deploy (mock tokens)
  deploy-chain.ts        # deploy one chain, DEPLOY_TARGET-driven
  configure-chain.ts     # re-apply post-deploy config idempotently (recovery path)
  seed-reserve.ts        # fund a contract's refund reserve
  pause.ts               # emergency pause/unpause
  refund.ts              # admin refund
deployments/
  base.json              # Base mainnet deployment record
  celo.json              # Celo mainnet deployment record
  celoSepolia.json       # testnet deployment record
supabase/
  migrations/            # schema (threads, refund_requests, funnel_events)
```

---

## Safety

- **Pausable** — both contracts have an owner-only kill switch (`pause()` / `unpause()`)
- **Daily spend cap** — AgentWallet enforces $10/day per token; resets at UTC midnight
- **Token whitelist** — ShipPostPayment accepts only the tokens whitelisted on its own chain (Base: USDC; Celo: cUSD, USDT, USDC)
- **Decimal-safe** — all token math uses `IERC20Metadata(token).decimals()`, never hardcoded
- **Consent ceiling** — `payForThread` takes a `maxAmount`, so an owner repricing between the read and the transaction reverts instead of overcharging
- **Deny-by-default paymaster** — `/api/paymaster` forwards two RPC methods and refuses any unrecognised chain, target or selector
