# Architecture (agent quick reference)

Invariants that are expensive to rediscover from the code: deployed addresses,
contract rules, and the gas-sponsorship rules. Everything else is read from the
source, which is the only description of this system that cannot go stale.

## Where each domain lives

| Domain | Code | Agent rules |
|---|---|---|
| On-chain — `ShipPostPayment`, `AgentWallet` | `contracts/` | this file ↓ |
| Backend — `/api/generate/stream`, pipeline | `app/api/generate/stream/`, `lib/pipeline/` | [`generate-flow.md`](generate-flow.md) |
| x402 — two models | `lib/x402/`, `lib/agent/orchestrator.ts` | [`x402.md`](x402.md) |
| Paying — EIP-5792 bundle, gas sponsorship | `lib/usePayForThread.ts`, `app/api/paymaster/` | this file ↓ |
| Refund — runbook | `app/api/refund/`, `lib/agent/reconcile.ts` | [`refunds.md`](refunds.md) |
| Chains, tokens, price | `lib/chainPolicy.ts`, `lib/tokens.ts`, `lib/threadPrice.ts` | this file ↓ |

## Deployed contracts

Source of truth is `deployments/<chain>.json` plus the `NEXT_PUBLIC_*` env vars; `lib/contracts.ts` reads env with hardcoded fallbacks for Celo and **no fallback for Base** (a missing address must fail loudly, not point at a placeholder).

| Chain | ShipPostPayment | AgentWallet | Tokens | First threadId |
|---|---|---|---|---|
| Base 8453 | `0x6915a137314e0588b671bc62e619cc4c3109a0b7` | `0x1c88ee8a8d0133d80c15a3f69def4b258e2cc933` | USDC | 1000000 |
| Celo 42220 | `0x921146fab0a60d48e1991495fc8a899d7c989f74` | `0x1eed568a18b89baf051c9294bcc8c5d579463444` | cUSD, USDT, USDC | 200000 |
| Celo Sepolia 11142220 | `0x277e140933d600cafcad38e2f1018e4fbd5476b2` | `0x7538627c5eef2193fa4960f03157f482eca333be` | mocks | 0 |

Deployed 2026-08-14 at $0.10. **Superseded Celo contract `0x0dea32414e884253b51a43b19a6a8c6b8f3b1800`** (price $0.05, 2-arg `payForThread`, counter reached 101291) is still live and unpaused; its reserve is 0. Thread ids start above the previous contract's counter on every redeploy, because a bare id in a log would otherwise be ambiguous — the database was already safe via the `(chain_id, onchain_thread_id)` unique index.

## Contract invariants (quick reference)

- **`ShipPostPayment`** — token whitelist only; SafeERC20 transfers (USDT-compatible); decimals via `IERC20Metadata(token).decimals()` (cUSD=18, USDT/USDC=6) — never hardcode; wei remainder falls into reserve. `ThreadRequested` is the event `verifyPayment` reads back.
- **`ShipPostPayment.priceUsdCents`** — the price is state, not a literal, settable by `setPrice` (onlyOwner, rejects 0, emits `PriceUpdated`). `payForThread(token, mode, maxAmount)` reverts `PRICE_EXCEEDS_MAX` above the caller's ceiling, so an owner repricing between a user's read and their transaction cannot overcharge them. Every consequence of "settable" lives in [`refunds.md`](refunds.md) — read it before touching anything that reads a price.
- **`AgentWallet`** — owner-only (orchestrator EOA); `executeX402Call` enforces the $10/token/day cap (mainnet; $50 testnet) and transfers **directly** to the service, so `x402Facilitator` may be unset; `Pausable` is the kill-switch, but `emergencyWithdraw` intentionally still runs when paused (block bad *spend*, never trap funds).

## Paying — sponsorship rules (quick reference)

- **Sponsorship is an optimisation, never a requirement.** `usePayForThread` asks `getCapabilities` first; only a wallet reporting `paymasterService` takes the `sendCalls` path. A wallet that cannot answer `wallet_getCapabilities` — MiniPay included — must fall through to the plain EOA path, not error. Never make the sponsored path the only path.
- **`/api/paymaster` is deny-by-default and must stay that way.** It forwards exactly `pm_getPaymasterStubData` and `pm_getPaymasterData`, only for a known chain / contract / selector, and it is rate-limited. Widening any of those turns it into a public wallet: anyone could have arbitrary transactions sponsored. The rate limit specifically bounds sponsoring `payForThread` calls that revert — the one drain the allowlist cannot see.
- **`CDP_PAYMASTER_URL` is server-only.** It never reaches the client; that indirection is the whole reason the proxy exists. Unset is a supported state — wallets simply pay their own gas.
- **Batching is a correctness fix, not gas polish.** approve and `payForThread` in one bundle removes the gap that produced both the USDT approve-receipt bug and the first-payment allowance-0 bug. Don't split them back apart.
- **A bundle can succeed with its call reverted.** `resolveBundleTxHash` must check the receipt status of the call, not just the bundle status.

## Chain config (`lib/`)

- `lib/chains.ts` — which chains **exist**: `getChain`, `explorerBase`, `celoSepolia`. Holds no allowlist.
- `lib/chainPolicy.ts` — which chains this deployment **accepts**: `SUPPORTED_CHAIN_IDS`, `DEFAULT_CHAIN_ID`, `isSupportedChain`, `chainLabel`, `isTestnet`, `isMiniPayChain`. Read from `NEXT_PUBLIC_SUPPORTED_CHAIN_IDS` / `NEXT_PUBLIC_DEFAULT_CHAIN_ID` at module load; a default outside the allowlist loses to the allowlist. (Replaced `lib/targetChain.ts`, deleted — it assumed exactly one chain.)
- `lib/wagmi.ts` — registers every supported chain with a transport each, default first.
- `lib/threadPrice.ts` — `readThreadPrice()`, the authoritative price. No local fallback on failure.
- `lib/payBundle.ts` — `buildPayCalls()`, the EIP-5792 approve+pay batch.
- `lib/tokens.ts` — token maps per chain. **Returns `Partial<Record<...>>`**: Base has no cUSD, so every caller must handle a missing symbol.
- `lib/contracts.ts` — contract addresses + ABIs, all chains.

## Environment variables

See `.env.example`, which documents each var and what breaks when it is missing. Key vars: `AGENT_WALLET_PRIVATE_KEY` (orchestrator EOA, encrypted in Vercel), `GROQ_API_KEY`, `SERPER_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE`, `NEXT_PUBLIC_PAYMENT_CONTRACT_*` / `NEXT_PUBLIC_AGENT_WALLET_*` (contract addresses exposed to client), `NEXT_PUBLIC_SUPPORTED_CHAIN_IDS` / `NEXT_PUBLIC_DEFAULT_CHAIN_ID` (the allowlist), `CDP_PAYMASTER_URL` (secret; server-only, proxied by `/api/paymaster`).

## Local-only

`scripts/` and `tools/` are ops utilities, not deployed — keep them out of lint/CI/deploy scope.
