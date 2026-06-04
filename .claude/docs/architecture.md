# Architecture (routing map)

The canonical, detailed walkthrough is **[`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md)** (progressive disclosure, Tầng 0→3, with diagrams + glossary). Don't duplicate it here — this file just routes you to the right section and holds a few agent quick-reference bits.

## Where each domain lives

| Domain | Read | Agent rules also in |
|---|---|---|
| Two layers + one generate run (big picture) | §1 | — |
| On-chain — `ShipPostPayment`, `AgentWallet` | §2.1 (detail §3.3 daily cap) | this file ↓ |
| Backend — `/api/generate/stream`, pipeline | §2.2 (detail §3.1, §3.2, §3.4) | [`generate-flow.md`](generate-flow.md) |
| x402 — two models | §2.3 | [`x402.md`](x402.md) |
| Frontend — `app/` + `components/` + `hooks/` | §2.4 | — |
| Data — Supabase | §2.5 | — |
| Refund — runbook | §2.6 (caveat §3.5) | [`refunds.md`](refunds.md) |
| Chain config, commands, glossary | Phụ lục | — |

## Contract invariants (quick reference)

- **`ShipPostPayment`** — token whitelist only; SafeERC20 transfers (USDT-compatible); decimals via `IERC20Metadata(token).decimals()` (cUSD=18, USDT/USDC=6) — never hardcode; wei remainder falls into reserve. `ThreadRequested` is the event `verifyPayment` reads back.
- **`AgentWallet`** — owner-only (orchestrator EOA); `executeX402Call` enforces $50/token/day cap; `Pausable` is the kill-switch, but `emergencyWithdraw` intentionally still runs when paused (block bad *spend*, never trap funds).

## Chain config (`lib/`)

- `lib/chains.ts` — `getChain`, `explorerBase`, `isSupportedChain` (Celoscan/Blockscout links).
- `lib/wagmi.ts` — Celo mainnet (42220) + Celo Sepolia (11142220) connectors.
- `lib/tokens.ts` — token addresses + decimals, both chains.
- `lib/contracts.ts` — ShipPostPayment + AgentWallet addresses, both chains.

## Environment variables

See `.env.example`. Key vars: `AGENT_WALLET_PRIVATE_KEY` (orchestrator EOA, encrypted in Vercel), `GROQ_API_KEY`, `SERPER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `NEXT_PUBLIC_*_MAINNET` (contract addresses exposed to client).

## Local-only

`scripts/` and `tools/` are ops utilities, not deployed — keep them out of lint/CI/deploy scope.
