# Mainnet Deploy & Frontend Integration

**Date:** 2026-05-08
**Status:** Approved

## Overview

Deploy `AgentWallet` and `ShipPostPayment` to Celo mainnet (chainId 42220) and wire the frontend env vars so the app works end-to-end on mainnet. No frontend logic changes required — only env vars and a new deploy script.

## Deploy Script (`scripts/deploy-mainnet.ts`)

A standalone mainnet deploy script, separate from the testnet `deploy.ts`. Key differences from testnet:

- No mock ERC20 tokens deployed — mainnet has real cUSD, USDT, USDC
- Token addresses sourced from `CELO_MAINNET_TOKENS` in `lib/tokens.ts`
- Deployer acts as treasury and reservePool (MVP simplicity)
- Deployer is also the AgentWallet owner (same key as `AGENT_WALLET_PRIVATE_KEY`)

### Steps (in order)

1. Deploy `AgentWallet` — owner = deployer EOA
2. Deploy `ShipPostPayment(agentWallet, deployer, deployer)`
3. Whitelist 3 real mainnet tokens via `setAllowedToken`:
   - cUSD `0x765DE816845861e75A25fCA122bb6898B8B1282a` (18 dec)
   - USDT `0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e` (6 dec)
   - USDC `0xcebA9300f2b948710d2653dD7B07f33A8B32118C` (6 dec)
4. Set daily spend caps on AgentWallet via `setDailySpendCap` — **$10/day per token**:
   - cUSD: `10n * 10n ** 18n`
   - USDT: `10_000_000n`
   - USDC: `10_000_000n`
5. Write `deployments/celo.json` with all contract addresses and metadata
6. Patch `.env.local` — overwrite `NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET` and `NEXT_PUBLIC_AGENT_WALLET_MAINNET`

### Running the script

```bash
hardhat run scripts/deploy-mainnet.ts --network celo
```

Requires `DEPLOYER_PRIVATE_KEY` set in `.env.local` with sufficient CELO for gas (~6 transactions).

### After deploy

Push env vars to Vercel manually:

```bash
vercel env add NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET production
vercel env add NEXT_PUBLIC_AGENT_WALLET_MAINNET production
```

Then redeploy:

```bash
vercel --prod
```

## Frontend Integration

No code changes required. `lib/contracts.ts` already reads from env vars with zero-address fallback:

```ts
ShipPostPayment: (process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET ?? '0x000...') as Address,
AgentWallet:     (process.env.NEXT_PUBLIC_AGENT_WALLET_MAINNET    ?? '0x000...') as Address,
```

`lib/tokens.ts` already has correct mainnet token addresses. `lib/wagmi.ts` already includes Celo mainnet (42220).

During implementation, scan for any hardcoded "testnet" guards or UI warnings that would block mainnet usage and remove them.

## Deployment Artifacts

| File | Purpose |
|------|---------|
| `scripts/deploy-mainnet.ts` | New mainnet deploy script |
| `deployments/celo.json` | Generated — contract addresses + metadata |
| `.env.local` | Auto-patched with mainnet contract addresses |

## Constraints

- `whenNotPaused` kill-switch must remain intact — never remove
- Daily cap $10/day per token on AgentWallet
- Deployer = treasury = reservePool = AgentWallet owner (MVP)
- Token whitelist enforced by `ShipPostPayment` — only 3 real stablecoins
