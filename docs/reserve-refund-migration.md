# Reserve-Funded Refund — Migration Runbook

Deploying **ShipPostPayment v2** (reserve retained in-contract + on-chain `refund()`).
See `docs/superpowers/specs/2026-07-06-reserve-funded-refund-design.md` for the why.

> ⚠️ This replaces the live mainnet payment contract. Do the testnet pass first and
> read every step — refunds and payments both route through this contract.

## Why a new contract (not an upgrade)

`ShipPostPayment` is non-upgradeable. v2 changes `payForThread` (keeps the 10% reserve
in-contract) and adds `refund()` / `withdrawReserve()`, so it must be redeployed. The old
contract stays deployed; the app simply stops pointing new payments at it.

## Footgun: threadId collision

The backend replay guard is keyed on `(chainId, onchain_thread_id)`. A fresh contract
counting from 1 would re-emit ids that already exist in Supabase (~32 mainnet threads
today), and new payments would 409 as duplicates. The v2 constructor takes `_startThreadId`;
the deploy scripts default it to **100000**, safely past any existing id. Never deploy with
a start id at or below the old contract's `threadCounter`.

## 1. Testnet (Celo Sepolia) first

```bash
pnpm compile
pnpm test:contracts
pnpm deploy:testnet          # deploys v2 with startThreadId = 100000
```

Then set `NEXT_PUBLIC_PAYMENT_CONTRACT_TESTNET` to the new address, redeploy a preview,
and exercise **pay → (force a failure) → refund** end-to-end. Confirm the refund tx pulls
from the contract's balance and `refunded(threadId)` flips true.

## 2. Mainnet

Env for the redeploy script (`scripts/redeploy-payment.ts`):

```bash
TREASURY_ADDRESS=0x...        # treasury payout target
NEW_OWNER_ADDRESS=0x...       # final owner (the refund/ops signer)
START_THREAD_ID=100000        # optional; defaults to 100000
# DEPLOYER_PRIVATE_KEY already set (funds the deploy, becomes initial owner)
```

```bash
hardhat run scripts/redeploy-payment.ts --network celo
```

The script reuses the existing AgentWallet, whitelists cUSD/USDT/USDC, transfers ownership
to `NEW_OWNER_ADDRESS`, writes `deployments/celo.json`, and patches
`NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET` in `.env.local`.

## 3. Point the app at v2

1. Vercel env (Production): `NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET = <new address>`.
2. Update the fallback address in `lib/contracts.ts` and the README contract table.
3. Redeploy the frontend.

## 4. Seed the refund reserve

The new contract starts with **0 reserve** and only accrues 10% of each new payment, so an
early refund would revert `RESERVE_INSUFFICIENT`. Transfer a small stablecoin float (e.g.
a few dollars of cUSD/USDT/USDC) directly to the new contract address. The reconcile-cron
heartbeat pages when the reserve dips below `RESERVE_MIN_BALANCE_USD` (default $0.5).

## 5. Legacy threads

Any thread still pending on the **old** contract refunds via the old EOA path (that code is
gone from v2, so in practice: with users ≈ 0 there should be none). New refunds use
`ShipPostPayment.refund()` automatically via `refundThread`.

## Ops afterwards

- Refunds are paid from the contract's own token balance, hard-capped by it and idempotent
  per threadId on-chain.
- `withdrawReserve(token, to, amount)` (owner) sweeps excess reserve to treasury.
- If refund volume ever approaches 10% of payments, raise `reserveBp` via `updateFeeSplit`
  (no redeploy).
