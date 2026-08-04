# x402 mainnet — settlement proofs

The agent makes **real x402 micro-payments** to its AI services. This has been
validated end-to-end on two mainnets, each against a different facilitator,
settling real USDC:

| Chain | Facilitator | Date | Section |
|---|---|---|---|
| Base mainnet | Coinbase CDP | 2026-07 | [below](#base-mainnet) |
| Celo mainnet | hosted `api.x402.celo.org` (v1) | 2026-08-04 | [below](#celo-mainnet) |

The settle chain is one env switch (`X402_CHAIN_ID` + `X402_FACILITATOR_URL` +
`X402_FACILITATOR_AUTH`); nothing else differs between the two runs.

---

# Base mainnet

## Proof transaction

| | |
|---|---|
| Network | Base mainnet (`eip155:8453`) |
| Settlement tx | [`0x7b71d5f74b832abab6c807ba0daccadbf62d4ca4dc5fda80c059bb14e3b92db1`](https://basescan.org/tx/0x7b71d5f74b832abab6c807ba0daccadbf62d4ca4dc5fda80c059bb14e3b92db1) |
| Block | 46833934 · status `success` |
| Token | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Amount | 0.001 USDC |
| Payer (agent EOA) | `0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78` (USDC `0.006586 → 0.005586`) |
| Recipient (treasury) | `0x66f744Af7B1D1218031C83Cb2c62EBa7e6138eD8` (`0 → 0.001`) |
| Facilitator | Coinbase CDP `https://api.cdp.coinbase.com/platform/v2/x402` |
| Broadcaster (`tx.from`) | `0x68a96f41ff1e9f2e7b591a931a4ad224e7c07863` — the **facilitator's relayer**, not the agent |

The agent EOA never paid gas: it only signs an EIP-3009 `transferWithAuthorization`;
the CDP facilitator verifies and broadcasts the settlement. (Confirmed: the agent's
ETH balance was unchanged across the run; only USDC moved.)

## What's live vs what's proven (honest framing)

- **Proven live on Base mainnet:** the x402 capability — agent signs `X-Payment`,
  CDP facilitator verifies + settles real USDC, the `/api/x402/groq` proxy returns
  the thread only after settlement. The tx above is irrefutable on basescan.
- **Live since 2026-07 (Model 2):** every paid thread's Groq settlement routes
  through this x402 rail regardless of where the user paid. MiniPay users still
  pay 0.05 cUSD on Celo; `getSettleMode()` is env-global (`X402_SETTLE_MODE` +
  `X402_CHAIN_ID`), no longer keyed on the payment chain. Infra failures degrade
  to the audited legacy push-to-sink with a Discord alert — x402-first, never
  thread-loss.

## How it was run

`scripts/x402-smoke.ts` drives `payGroqViaX402` directly against the running proxy.
The settlement chain/facilitator come from env; the proof run used:

```
X402_CHAIN_ID=8453
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402
CDP_API_KEY_ID=…            # CDP Secret API Key (Ed25519)
CDP_API_KEY_SECRET=…
X402_PAY_TO=0x66f744…8eD8   # treasury we control, ≠ agent EOA
X402_PROXY_BASE_URL=http://localhost:3000
```

```bash
pnpm dev                                          # proxy → Base mainnet + CDP
pnpm dlx tsx scripts/x402-smoke.ts --expect=success
```

The same driver also exercises the three guards (`--expect=cap|pause|fail`); those
were validated on Base **Sepolia** first (no funds move on any guard path).

### CDP auth detail

The CDP facilitator rejects a static bearer token — it requires a request-scoped
JWT (host+method+path baked in, ~2 min TTL). `lib/x402/server.ts` mints one per
facilitator operation (`/verify`, `/settle`, `/supported`) via
`@coinbase/cdp-sdk` `generateJwt`, keyed on `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET`.
The x402 core calls this fresh on every verify/settle, so tokens never go stale.

## Model 2 — shipped

Implemented 2026-07-08 (spec:
`docs/superpowers/specs/2026-07-08-model2-x402-all-threads-design.md`). The
settle layer is selected by env (`X402_SETTLE_MODE=x402` + `X402_CHAIN_ID=8453`),
decoupled from the payment chain. The agent EOA keeps a small manual USDC float
on Base; the Redis `x402:paused` switch now means "fall back to legacy", making
it a no-deploy rollback lever.

---

# Celo mainnet

Settling on Celo puts the x402 spend on the **same chain the user pays on**, so a
thread no longer needs a separate USDC float on another network — the 40% treasury
split of each $0.05 payment lands on the agent EOA in Celo USDC and funds the next
run's micro-payment.

## Proof transaction

| | |
|---|---|
| Network | Celo mainnet (`eip155:42220`) |
| Settlement tx | [`0x116ddbec097c5598c9fc95e9a640ee37f4cbe9864cbbcae84ae6742c002b9139`](https://celoscan.io/tx/0x116ddbec097c5598c9fc95e9a640ee37f4cbe9864cbbcae84ae6742c002b9139) |
| Block | 73915090 · status `success` · gas used 85834 |
| Date | 2026-08-04T03:57:28Z |
| Token | USDC `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` (Circle native issuance) |
| Amount | 0.001 USDC |
| Method | `transferWithAuthorization` (`0xe3ee160e`) called directly on the USDC contract |
| Payer (agent EOA) | `0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78` — signs only |
| Recipient (treasury) | `0x66f744Af7B1D1218031C83Cb2c62EBa7e6138eD8` |
| Facilitator | `https://api.x402.celo.org` (auth: `X-API-Key`) |
| Broadcaster (`tx.from`) | `0x0d74d5cefd2e7f24e623330ebe3d8d4cb45ffb48` — the **facilitator's relayer** |

The broadcaster address matches, exactly, the signer that the facilitator's own
`GET /supported` advertises for `eip155:42220`. The agent EOA paid no gas, which is
what separates a facilitator settlement from a self-sent transfer dressed up as one.

## Two details that made this work

**The facilitator serves x402 v1 only.** Its `/supported` advertises an
`eip155:42220` v2 kind, but `/verify` and `/settle` reject that kind with
`unsupported_scheme`; only the bare `celo` v1 network is honoured. Rather than
downgrade the whole codebase, `lib/x402/facilitator-v1.ts` wraps the HTTP
facilitator client and rewrites the payload on the way out for chains whose config
carries a `v1Network`. Delete that field and the chain goes back to plain v2 with
no other change.

**The price could not be a money string.** Passing `"$0.001"` makes `@x402/evm`
resolve the token through its own `DEFAULT_STABLECOINS` table, which lists Base,
Monad, Stable and others but has never listed Celo. On Celo it threw
`No default asset configured for network eip155:42220` while *building the 402
challenge*, so the proxy answered 500 and every run degraded to the legacy settle —
a thread the user still received, with no x402 payment behind it. The route now
prices in an explicit asset + atomic amount carrying the token's EIP-712 domain
(`priceForChain`, commit `6f83b50`), which bypasses that table on every chain.

Both failures were silent from the user's seat: the thread completes either way.
The only reliable signal is the on-chain shape of `groq_tx_hash` — an x402 settle
calls USDC directly via EIP-3009, a legacy settle calls `executeX402Call` on the
AgentWallet contract and pushes to the `0x…dEaD` sink.

## How it was run

Not the smoke script — a **real paid thread** (thread `72`, mode 2) through a local
dev server pointed at Celo mainnet, so the whole pipeline ran, not just the payment
leg. Env for the proof run:

```
X402_SETTLE_MODE=x402
X402_CHAIN_ID=42220
X402_FACILITATOR_URL=https://api.x402.celo.org
X402_FACILITATOR_AUTH=api-key
X402_FACILITATOR_API_KEY=x402_…            # from x402.celo.org, prepaid credits
X402_PAY_TO=0x66f744…8eD8                  # treasury we control, ≠ agent EOA
X402_PROXY_BASE_URL=http://localhost:3000
```

The Celo facilitator meters prepaid credits against the API key (1 credit =
1 settlement, $0.001 each, 500 free) and sends it as `X-API-Key`, not a bearer —
`X402_FACILITATOR_AUTH` names the scheme explicitly so leftover CDP credentials
can never be sent to a non-Coinbase host.

## Not yet true in production

Production still settles on Base: the Vercel env has not been switched. This proof
is local-dev against Celo mainnet — the chain, facilitator, token and money are all
real, the deployment is not.

Known gap: `threads.groq_settle_chain_id` no longer distinguishes Model 1 from
Model 2 once settlement moves to Celo. Both write `42220` — the payment chain for a
legacy settle, the settle chain for an x402 one. Thread `71` (legacy) and thread
`72` (x402) are indistinguishable by that column alone.
