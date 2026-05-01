# Session State

**Last updated:** 2026-05-01
**Current plan:** `docs/superpowers/plans/2026-04-24-shippost-week1-foundation.md`
**Current task:** Task 23 done (Vercel deploy live); next = MiniPay smoke test (manual) + AgentWallet redeploy with Pausable
**Last completed step:** Quality fix-pass (4 commits) + `vercel --prod`

## Production
- URL: https://shippost-kappa.vercel.app  (alias)
- Latest deployment id: dpl_HahFZHw3EvBcZ82xZUrqiL7Rt9Dw  (built against new Pausable contracts)
- Smoke: HTTP 200, ~5KB shell

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
- [x] Task 23 — Vercel deploy (live: https://shippost-kappa.vercel.app); MiniPay smoke test on phone is manual
- [ ] Redeploy AgentWallet (Pausable) on Celo Sepolia + update lib/contracts.ts + Vercel env
- [ ] Task 24 — Demo video + docs (manual)
- [ ] Task 25 — Week 1 gate verification

## Deployed addresses (Celo Sepolia — chainId 11142220, redeployed 2026-05-01 with Pausable)
- ShipPostPayment: 0x277e140933d600cafcad38e2f1018e4fbd5476b2
- AgentWallet: 0x7538627c5eef2193fa4960f03157f482eca333be (Pausable kill-switch live)
- MockCUSD: 0xb7e155e9d4ab5a97f950c3259dace91b0f6c33f5
- MockUSDT: 0xd589cc6f20103401c1e168b9d2b3075e8b5fabca
- MockUSDC: 0x6bba6a2326fd6ab4694de5c9369001d7a3720dc1
- Explorer: https://celo-sepolia.blockscout.com

### Old (defunct) Sepolia addresses — kept for reference only
- ShipPostPayment: 0x12da5404e73fbdb21908f598eebbd552f6172a65
- AgentWallet: 0xe5adff43dd082cbd15759e6a21a4880a33cc48a5
  These were superseded after AgentWallet got the Pausable kill-switch.

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
- Task 23: GitHub repo đã push (github.com/hms1499/shippost), Vercel đã link, env vars đã set xong
  - Chỉ cần chạy `vercel --prod` để hoàn tất deploy
- Env vars đã set trên Vercel production: AGENT_WALLET_PRIVATE_KEY, GROQ_API_KEY, MOCK_SETTLE=true, NEXT_PUBLIC_PAYMENT_CONTRACT_TESTNET, NEXT_PUBLIC_AGENT_WALLET_TESTNET
- AgentWallet cần có cUSD testnet để settle x402 khi MOCK_SETTLE=false (Week 2)
- `pnpm test:contracts` → 10 passing
- `pnpm build` → passes (242KB uncompressed, ~90KB gzipped on /)
