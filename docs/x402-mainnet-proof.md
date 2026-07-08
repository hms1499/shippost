# x402 on Base mainnet — settlement proof

The agent makes **real x402 micro-payments** to its AI services. This was validated
end-to-end on **Base mainnet** against the **Coinbase CDP facilitator**, settling
real USDC.

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
