# Session State

**Last updated:** 2026-04-29
**Current plan:** `docs/superpowers/plans/2026-04-24-shippost-week1-foundation.md`
**Current task:** Task 23 — Vercel deploy + MiniPay smoke test
**Last completed step:** Tasks 18-22 done in one session

## Completed tasks (Week 1)
- [x] Task 1 — Initialize project repo
- [x] Task 2 — tsconfig.json
- [x] Task 3 — `lib/wagmi.ts` (now uses celoSepolia instead of Alfajores)
- [x] Task 4 — `lib/minipay.ts`
- [x] Task 5 — `app/layout.tsx` + providers + page
- [x] Task 6 — `lib/tokens.ts` + `lib/useBalances.ts` + `components/WalletStatus.tsx`
- [x] Task 7 — `hardhat.config.ts` (Hardhat 3, defineConfig + plugins array)
- [x] Task 8  — `contracts/mocks/MockERC20.sol`
- [x] Task 9  — `contracts/ShipPostPayment.sol` + deploy test
- [x] Task 10 — ShipPostPayment payForThread cUSD test
- [x] Task 11 — ShipPostPayment multi-decimal USDT/USDC tests
- [x] Task 12 — ShipPostPayment event + pause tests (10 passing total)
- [x] Task 13 — `contracts/AgentWallet.sol` + deploy test
- [x] Task 14 — AgentWallet executeX402Call tests (10 passing total)
- [x] Task 15 — Deploy to Celo Sepolia + `scripts/deploy.ts`
- [x] Task 16 — `lib/contracts.ts` (addresses + ABIs)
- [x] Task 17 — `lib/usePayForThread.ts`
- [x] Task 18 — `components/ModePicker.tsx` + `components/EducationalInput.tsx` + `components/TokenSelector.tsx`
- [x] Task 19 — `components/GeneratingStatus.tsx` + `app/page.tsx` (full flow wired)
- [x] Task 20 — `app/api/x402/groq/route.ts` (mock Groq proxy)
- [x] Task 21 — Real Groq call + `lib/orchestrator.ts` (on-chain x402 settlement)
- [x] Task 22 — topic/audience/length wired from UI → API

## Pending tasks
- [ ] Task 23 — Vercel deploy + MiniPay smoke test (manual: GitHub push, Vercel import, set env vars)
- [ ] Task 24 — Demo video + docs (manual)
- [ ] Task 25 — Week 1 gate verification

## Deployed addresses (Celo Sepolia — chainId 11142220)
- ShipPostPayment: 0x12da5404e73fbdb21908f598eebbd552f6172a65
- AgentWallet: 0xe5adff43dd082cbd15759e6a21a4880a33cc48a5
- MockCUSD: 0xde53066fc77565f7258d5d59ccf129a2ba43a3be
- MockUSDT: 0x174caa3b72fc683de0d62474ed1e24e36a6ab311
- MockUSDC: 0xfe26e6efa3189cf0eb7b5014b94137493def9107
- Explorer: https://celo-sepolia.blockscout.com

## Key decisions made
- `"type": "module"` in package.json (Hardhat 3 ESM requirement)
- Hardhat 3 requires `defineConfig + plugins` array (not side-effect imports like Hardhat 2)
- Tests use `node:test` + `chai`, import `{ describe, it } from 'node:test'`
- `network.create()` not `network.connect()` (connect() deprecated in Hardhat 3)
- Alfajores deprecated → switched to Celo Sepolia (chainId 11142220)
- celoSepolia not in viem yet — defined manually with `defineChain` in `lib/wagmi.ts`
- `MOCK_SETTLE=true` in Week 1 (skip on-chain settle), flip to `false` in Week 2
- `orchestrator.ts` uses `AGENT_WALLET_PRIVATE_KEY` (not `ORCHESTRATOR_PRIVATE_KEY`) — matches CLAUDE.md
- Explorer for Celo Sepolia: `https://celo-sepolia.blockscout.com` (not celoscan)
- Tasks 21+22 gộp: real Groq call + audience/length prompt engineering done together

## Cần nhớ cho session sau
- Task 23 là manual: push GitHub → import Vercel → set env vars → deploy
- Env vars cần set trên Vercel: AGENT_WALLET_PRIVATE_KEY, GROQ_API_KEY, MOCK_SETTLE=true, NEXT_PUBLIC_* contract addresses
- AgentWallet cần có cUSD testnet để settle x402 (fund thủ công trên Celo Sepolia)
- `pnpm test:contracts` → 10 passing
- `pnpm build` → passes (242KB uncompressed, ~90KB gzipped on /)
