# ShipPost — Design Document

**Date**: 2026-04-24
**Status**: ✅ Approved 2026-04-24 — pending implementation plan
**Target**: Proof of Ship competition, MiniPay MiniApp category (AI Agents)
**Timeline**: 4 weeks

---

## 1. Executive Summary

**ShipPost** is a pay-per-use AI thread writer that runs as a MiniApp inside Opera's MiniPay wallet. Users pay **$0.05 cUSD/USDT/USDC per thread**. Behind the scenes, an ERC-8004 compatible agent wallet orchestrates **3-5 x402 micro-payments** to AI services (Groq, fal.ai, Serper) to research, generate, fact-check and illustrate a ready-to-post X thread in under 30 seconds.

**One-liner**: *"The pay-per-post AI thread writer for crypto builders. $0.05/thread. No subscription. Powered by MiniPay."*

### Why this fits the competition

| Brief requirement | How ShipPost delivers |
|---|---|
| Real app for real users | Emerging-market devs need X brand to get remote jobs — Typefully's $30/mo is 15-20% of their salary |
| Drives real transactions | Every thread = 1 user payment tx + 3-5 agent x402 txs on Celo mainnet |
| AI Agent with MiniPay use case | Core category — agent autonomously pays for AI services per thread |
| Pay-as-you-go alternative to subscription | Explicit pitch: "subscription killer" |
| Uses MiniPay hook | `window.ethereum.isMiniPay` detection, injected provider, no WalletConnect modal |
| Built on Celo mainnet | Deploy contracts + cUSD/USDT/USDC native |

---

## 2. Target User

### Primary persona: "Chidi from Lagos"

> Chidi is 23, a Solidity dev in Lagos with 1 year experience. He wants to apply for remote jobs in the US/EU ($3-5k/month, life-changing), but his X profile is empty because he doesn't know how to write viral threads. Typefully's $30/month is unaffordable (15% of his salary). He already uses MiniPay for freelance payouts in cUSD. He opens ShipPost from Discover, pays 0.05 cUSD, generates a thread about "How I built my first Celo dapp", posts. A week later, 3 people DM him asking to hire.

### Target segments (priority order)

1. **Primary**: crypto/dev creators in emerging markets (Nigeria, India, SEA, LatAm, Brazil) already using MiniPay for daily stablecoin needs
2. **Secondary**: Junior devs and bootcamp graduates wanting to build personal brand on X
3. **Expansion**: Protocol community managers, DevRel folks

### Addressable market estimate

MiniPay has ~14M users. Conservative estimate: ~2-3% are dev/crypto-curious builders = **280k-420k addressable users**. Enough for MVP.

---

## 3. Product Scope

### Two modes

| Mode | Input | Output | Use case | Pipeline |
|---|---|---|---|---|
| **🎓 Educational** | Topic/concept (e.g., "Explain EIP-7702") + audience + length | Hook → 3 core concepts → analogy → CTA | Evergreen, weekly | Groq + Flux + optional self-check |
| **🔥 Hot Take** | URL or event description + angle (bullish/bearish/skeptical/contrarian) | Hook → fact+data → perspective → prediction | Daily, time-sensitive | Serper + CoinGecko + Groq + Groq fact-check + Flux |

### Core differentiators (vs Typefully, Tweet Hunter, AIXBT)

1. **Pay-per-use in stablecoin** — no $30/month subscription. Per-thread pricing fits emerging-market mindset.
2. **Crypto-native by default** — prompts, examples, data sources all built for crypto/dev content.
3. **Transparent on-chain AI spend** — user sees exactly which service the agent paid and how much via Celoscan links.

### Anti-features (explicitly NOT in MVP)

- ❌ Auto-scheduling / post queue
- ❌ Analytics dashboard (for users — we have one for judges only)
- ❌ Team accounts
- ❌ Thread templates marketplace
- ❌ Native mobile app (MiniPay in-app browser is sufficient)
- ❌ Proof of Humanity integration
- ❌ Offline draft caching (post-MVP)
- ❌ Localization beyond English

---

## 4. System Architecture

### High-level flow

```
MiniPay In-App Browser
  └─► ShipPost Next.js MiniApp (Vercel Edge)
        ├─ Detect window.ethereum.isMiniPay
        ├─ wagmi + viem → injected provider
        └─ Pay 0.05 {cUSD|USDT|USDC} (one-tap)
              │
              ▼
Celo Mainnet Contracts
  ├─ ShipPostPayment.sol — splitter (50% agent / 40% treasury / 10% reserve)
  └─ AgentWallet.sol — ERC-8004 compatible, holds funds for x402
        │
        │ Event: ThreadRequested(user, threadId, mode, token)
        ▼
Orchestrator Backend (Next.js API route)
  └─ Agent wallet signs x402 payment headers → calls services:
        ├─ Groq LLM (generation)
        ├─ fal.ai Flux Schnell (thumbnail)
        ├─ Serper (search, Mode B)
        ├─ CoinGecko (market data, Mode B)
        └─ Groq (fact-check pass, Mode B)
              │
              ▼
Supabase (thread history) + IndexedDB (client cache)
              │
              ▼
User preview → Edit → "Share to X" deep link
```

### Smart contracts

#### `ShipPostPayment.sol` (~80 LOC)
```
allowedTokens: mapping(address => bool)  // cUSD, USDT, USDC

payForThread(address token, uint8 mode) external returns (uint256 threadId)
  ├─ require token in allowedTokens
  ├─ compute amount = 0.05 * 10^decimals(token)
  ├─ transferFrom(msg.sender, this, amount)
  ├─ split 50/40/10 to agentWallet/treasury/reserve (same token)
  ├─ emit ThreadRequested(user, threadId++, mode, token)
  └─ return threadId

Owner functions:
  - updateFeeSplit(uint256 agentBp, uint256 treasuryBp, uint256 reserveBp)
  - setAllowedToken(address token, bool allowed)
  - pause() / unpause() [Pausable]
```

**Guards**: `Pausable` kill-switch, reentrancy protection via checks-effects-interactions, token whitelist only.

**Decimal handling**: cUSD=18, USDT=6, USDC=6. Use `IERC20Metadata(token).decimals()` to compute amount dynamically.

#### `AgentWallet.sol` (~120 LOC) — ERC-8004 compatible
```
owner: orchestrator backend wallet (EOA in Vercel env var)
dailySpendCap: mapping(address => uint256)  // per-token cap (cUSD=50e18, USDT=50e6, USDC=50e6)
spentToday: mapping(address => uint256)     // per-token spend, reset every 24h

executeX402Call(address token, bytes callData, uint256 maxFee) external onlyOwner
  ├─ require spentToday[token] + maxFee <= dailySpendCap[token]
  ├─ require approve() already set for x402 facilitator
  ├─ call x402 proxy (internal)
  ├─ emit X402PaymentMade(service, token, amount, threadId)
  └─ spentToday[token] += actualFee

withdraw(address token, uint256 amount) external onlyOwner  // emergency
```

**Guards**: single-owner EOA for MVP (multisig in v2), daily spend cap, immutable cap on max per-call fee.

#### ThreadRegistry.sol — **NOT in MVP** (logs thread hash on-chain for provenance; post-MVP)

### x402 Proxy (custom build — Option X1)

Reason: As of early 2026, most AI APIs (Groq, fal.ai, Serper) don't support x402 natively. We build a Next.js API route that:

1. Accepts HTTP request with `X-Payment` header (EIP-712 signature from agent wallet)
2. Verifies payment authorization on-chain (or signed payment intent)
3. Forwards the request to the underlying API using fiat credit (our paid API keys)
4. Settles payment (pulls cUSD/USDT/USDC from agent wallet to proxy treasury)
5. Returns API response

**Why self-build vs Coinbase CDP facilitator**: full control over service list, no markup, proof of on-chain x402 activity for judges, reusable for future projects.

**Effort**: 3-4 days in Week 1.

### Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 App Router, TypeScript |
| Wallet | viem + wagmi (MiniPay connector) |
| UI | Tailwind + shadcn/ui |
| Smart contract | Hardhat + Solidity 0.8.24 + OpenZeppelin |
| Backend | Next.js API routes (Edge where possible) |
| LLM | Groq (Llama 3.3 70B) — free tier covers MVP |
| Image | fal.ai Flux Schnell — $5 signup credit |
| Search (Mode B) | Serper.dev — 2.5k free queries |
| Fact-check (Mode B) | Groq again (different prompt/temp) — free |
| Market data | CoinGecko free tier |
| DB | Supabase free tier (Postgres + auth) |
| Frontend deploy | Vercel |
| Contract deploy | Celo mainnet |

### Security posture MVP

- Agent wallet private key in Vercel encrypted env var; daily cap $50
- Rate limit: 10 threads/wallet/day
- Input sanitization: separate system/user prompts, reject prompt injection patterns
- No PII stored; Supabase only holds wallet address + thread metadata
- Contract `Pausable` kill-switch for emergencies

---

## 5. User Flow + UI

### Design system

- **Primary color**: blue `#2563EB` (Tailwind `blue-600`)
- **Theme**: dark mode default (MiniPay users often use at night)
- **Typography**: Inter (Google Fonts)
- **Icons**: Lucide
- **Animations**: Framer Motion (critical for Screen 3 progress theatre)
- **Bundle budget**: <200KB gzipped initial load
- **Mobile-only**: MiniPay webview is mobile; no desktop support

### Six core screens

#### Screen 1: Mode picker
Two cards (Educational, Hot Take) + "My threads" link.

#### Screen 2A: Educational input
Topic text field + audience radio (Beginner/Intermediate/Advanced) + length radio (5/8/12 tweets) + token selector + "Generate for 0.05 {token}" CTA.

#### Screen 2B: Hot Take input
Event URL/description field + angle radio (Bullish/Bearish/Skeptical/Contrarian) + token selector + CTA.

#### Screen 3: Generating (progress theatre) — **the competition demo moment**
Step-by-step list with checkmarks + dollar amounts spent + link to agent wallet on Celoscan. Shows x402 payments in real time.

```
🔍 Searching news      ✓ $0.001
📊 Fetching price      ✓ $0.000
✍️  Writing thread     ⏳ ...
✅ Fact-checking       —
🎨 Creating thumbnail  —

Agent wallet spent so far: $0.011 of $0.025 budget
[View on Celoscan →]
```

#### Screen 4: Preview + Edit
Numbered tweet list (1/8, 2/8…), each with inline edit button, thumbnail preview with regenerate option, action row: Copy all / Post to X / Save draft.

#### Screen 5: Share to X
Deep link `twitter://post?message=...` with X app intent fallback to web. Helper text guides user through posting thread as replies (X mobile limitation).

#### Screen 6: Post-share
Cost transparency breakdown (user paid, agent spent, platform kept) + Celoscan link + "Write another" CTA.

### History screen
Card list of past threads with timestamp, mode badge, cost, and View/Re-post actions.

### Error states

| Error | UX response |
|---|---|
| Insufficient balance | "You need 0.05 {token}. Top up in MiniPay?" + deep link |
| Token not approved | Auto-trigger approve tx (or use EIP-2612 permit if token supports) |
| Approve rejected | "Cancelled. Try again?" retry button |
| Pay tx failed | Contract reverts, auto-refund |
| x402 fails mid-pipeline | Partial refund (70-90%) from reserve, show partial output |
| All x402 fail | Full refund + free credit for retry |
| Agent wallet bucket empty | Fallback to other token bucket; if all empty, pause app + alert operator |
| Generation >60s | Progress indicator + cancel option (50% refund) |

### MiniPay-specific features

1. **One-tap payment** — `eth_sendTransaction` via injected provider, skip WalletConnect
2. **Token auto-select** — `balanceOf()` on all 3 tokens, default to highest balance
3. **Share to X deep link** — twitter://post intent, web fallback
4. **Bundle size <200KB** — aggressive code splitting, edge runtime
5. **EN only** — no localization in MVP

---

## 6. MVP Execution Plan (4 weeks)

### Definition of Done

- Deployed Celo mainnet, contracts verified on Celoscan
- Open source GitHub repo with README runnable by a stranger in 15 min
- MiniPay hook integrated, works inside MiniPay webview
- Multi-token payment (cUSD + USDT + USDC) working
- Mode A complete, 30+ real threads on mainnet
- x402 proxy with ≥3 services
- Demo video 2-3 min + pitch deck 1 slide
- Public analytics page showing live stats

### Week 1 — Scope & Foundation

| Day | Deliverable |
|---|---|
| 1 | Repo init, Next.js + wagmi + viem + Tailwind + shadcn, deploy Vercel preview |
| 2 | MiniPay detection hook + auto-connect + token balance fetcher |
| 3 | `ShipPostPayment.sol` + tests (multi-token, splitter) |
| 4 | `AgentWallet.sol` + tests. Deploy Alfajores testnet |
| 5 | x402 proxy POC — 1 service (Groq) end-to-end |
| 6 | UI: Mode picker + Educational input + token selector |
| 7 | Testnet end-to-end: pay → event → agent x402 → mock output |

**Gate**: 30-second testnet demo video for mentor.

### Week 2 — Ship Mode A

| Day | Deliverable |
|---|---|
| 8 | Mode A prompt engineering (hook/explain/analogy/CTA) |
| 9 | x402 proxy adds Flux Schnell |
| 10 | Progress theatre UI with live x402 status |
| 11 | Thread preview + edit + Share to X deep link |
| 12 | **Deploy Celo mainnet** |
| 13 | Bug bash with 5 friends, record feedback |
| 14 | Fix critical bugs, ship v0.1 |

**Gate**: ≥10 threads generated, ≥5 unique wallets, $0.50+ on-chain volume.

### Week 3 — Refine + Mode B

| Day | Deliverable |
|---|---|
| 15 | x402 proxy adds Serper + Groq fact-check |
| 16 | Mode B pipeline + 4 angle templates |
| 17 | URL parser for tweet/news links |
| 18 | Error states + refund flow |
| 19 | Mobile UX polish + bundle size optimization |
| 20 | History screen + public analytics page |
| 21 | User testing round 2 with 10 creators |

**Gate**: ≥30 threads, both modes working, ≥3 repeat users.

### Week 4 — Present

| Day | Deliverable |
|---|---|
| 22 | Analytics dashboard for judges (live) |
| 23 | Demo video 2-3 min |
| 24 | Pitch deck 1 slide |
| 25 | README + architecture diagrams |
| 26 | Security pass — env vars, caps, pause |
| 27 | Stress test: 50 consecutive threads |
| 28 | **Submit** + post on X + t.me/proofofship |

**Gate**: ≥50 threads total, submission sent.

### Stretch goals (if ahead)

1. Dev tutorial mode (reuse pipeline, new prompt)
2. Referral rewards
3. Thread analytics via X API
4. Sponsored topics (B2B revenue)
5. Auto-post add-on ($0.10 extra)

### Cut list (if behind, in priority order)

1. Drop Mode B entirely (ship A only)
2. Drop thumbnail image generation (text-only threads)
3. Drop multi-token (cUSD only)
4. Drop analytics dashboard (Celoscan manual)
5. **RED LINE**: do not cut x402 proxy

### Resources to prepare before Day 1

- Vercel + Supabase accounts (free)
- Groq API key (free tier)
- fal.ai account ($5 signup credit)
- Serper.dev account (2.5k free)
- Celo mainnet cUSD ~$10-15 for agent wallet
- Testnet CELO from faucet
- GitHub repo name: `shippost`
- Deploy wallet private key (password manager, never in git)

---

## 7. Economics

### Unit economics per thread

| Flow | Amount |
|---|---|
| User pays | $0.050 |
| → Agent wallet | $0.025 |
| → Treasury (dev revenue) | $0.020 |
| → Reserve pool | $0.005 |
| Agent spends on x402 (Mode A) | ~$0.004 |
| Agent spends on x402 (Mode B) | ~$0.008 |
| **Net profit per thread** | **~$0.036-0.040** |

**Margin**: 72-80% at $0.05 flat pricing with Groq-only pipeline.

### Out-of-pocket budget day-0

| Item | Cost |
|---|---|
| Agent wallet pre-fund (cUSD) | $10-15 |
| Multi-token buckets (USDT + USDC seed) | $10 (optional) |
| Celo mainnet deploy gas | $0.50 |
| API credits (all free tier in MVP) | $0 |
| **Total** | **~$20-25** |

### ROI

Competition max reward $2,000 USDT → 80-100x return on $20-25 investment.

### Post-MVP revenue streams (v2)

1. Sponsored topics ($20-100/slot from protocols)
2. Affiliate links (Celo, Uniswap, Jumper, Rabby)
3. Auto-post add-on ($0.10 extra)
4. Tip jar (crypto users tip creators)

---

## 8. Risks & Mitigations

### Technical

| Risk | Mitigation |
|---|---|
| x402 proxy security hole | On-chain payment verification before forward; daily cap |
| Agent wallet key leak | Vercel encrypted env; daily cap $50; multisig v2 |
| Groq hits rate limit | Gemini Flash fallback (also free tier) |
| Contract decimal bugs (cUSD 18 vs USDT/USDC 6) | Unit tests cover all 3 tokens; fork mainnet test |
| MiniPay webview edge cases | Test inside real MiniPay from Day 2 |
| RPC downtime | Multi-RPC fallback (Infura + public + Forno) |
| Bundle >200KB | Weekly bundle analyzer audit |

### Financial

| Risk | Mitigation |
|---|---|
| Spam (10k free threads via bot) | Rate limit 10/wallet/day + min-balance check |
| False refund claims | Refund only for x402 failure, not subjective quality |
| API price hikes | `updateFeeSplit()`; worst case raise price to $0.07 |
| cUSD depeg | Monitor; pause contract if peg breaks |

### Market

| Risk | Mitigation |
|---|---|
| **Judge sees it as "crypto insider tool"** | Reposition pitch to emerging-market brand-building; show wallets from Nigeria/India |
| Competitor launches MiniPay integration first | Ship fast; niche defense (crypto/dev specific) |
| User doesn't return after first thread | Collect feedback from every tester; iterate prompts aggressively |
| Thread quality too low for viral | Self-QA every prompt template before release (builder is the user) |

### Operational

| Risk | Mitigation |
|---|---|
| Solo dev burnout Week 3 | Aggressive cut list; 1 rest day/week; no feature creep |
| MiniPay Discover submission rejected | Submit Week 3, not Week 4; plan B: share direct link |
| Slow network in target markets | Progress theatre <30s; show partial output early |

---

## 9. Success Metrics

### Must-have (eligibility)

- Deployed Celo mainnet, verified
- Open source repo public
- MiniPay hook working
- Claim reward via MiniPay

### Target KPIs (differentiation)

| Metric | Target | Stretch |
|---|---|---|
| Threads on mainnet | 50 | 200+ |
| Unique paying wallets | 15 | 50+ |
| On-chain volume | $2.50 | $10+ |
| x402 payments | 200+ | 1000+ |
| Repeat users (≥2 threads) | 3 | 15+ |
| Users from ≥3 countries | 3 | 5+ |
| GitHub stars | 20 | 100+ |

### Weekly targets

| | W1 | W2 | W3 | W4 |
|---|---|---|---|---|
| Threads on-chain | 5 (self) | 20 | 50 | 100+ |
| Unique wallets | 1 | 5-10 | 20 | 40+ |
| X mentions | 0 | 3 | 15 | 50+ |

### Public analytics dashboard (built Week 4)

Live page shown to judges with: total threads, unique wallets, volume, x402 count, countries, agent wallet balance, last 10 threads with Celoscan links.

### Pitch narrative tests

Judge reading the pitch deck must come away with clear answers to:
1. Why MiniPay? → pay-per-use fits emerging markets; Typefully unaffordable
2. Who's the user? → Chidi-from-Lagos story, not "all crypto users"
3. What's the x402 moment? → Screen 3 progress theatre video
4. Will this survive? → unit economics ($0.05 revenue → ~$0.010-0.014 cost → $0.036-0.040 profit/thread, 72-80% margin)

---

## 10. Decisions & Open Questions

### Decided
- **GitHub repo name**: `shippost`

### Deferred to implementation phase
- Domain (optional; Vercel subdomain acceptable for MVP)
- Whether to invest in custom logo/branding in Week 4 polish phase
- Whether Week 4 should include a Twitter/X marketing push before submission day

---

## Appendix A — MiniPay Integration Checklist

- [ ] Detect `window.ethereum.isMiniPay === true`
- [ ] Skip WalletConnect modal when in MiniPay
- [ ] Use viem + wagmi (never ethers.js per brief)
- [ ] Mobile-first responsive design (MiniPay is mobile-only)
- [ ] Aggressive code splitting for 3G/4G users
- [ ] Celo mainnet deployment
- [ ] Open source repo public from Day 1
- [ ] cUSD/USDT/USDC native token support
- [ ] Claim rewards via MiniPay
- [ ] No ethers.js imports

## Appendix B — Celo Mainnet Token Addresses

| Token | Address | Decimals |
|---|---|---|
| cUSD | `0x765DE816845861e75A25fCA122bb6898B8B1282a` | 18 |
| USDT | `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` | 6 |
| USDC | `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` | 6 |

## Appendix C — API Cost Reference

| Service | Free tier | Cost beyond free |
|---|---|---|
| Groq Llama 3.3 70B | ~14,400 req/day | ~$0.50/1M tokens |
| fal.ai Flux Schnell | $5 signup (~1,600 images) | $0.003/image |
| Serper.dev | 2,500 queries | $0.001/query |
| CoinGecko Free | 10k calls/month | — |
| Celo gas | — | ~$0.001/tx |
