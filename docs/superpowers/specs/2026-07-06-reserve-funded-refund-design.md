# ShipPostPayment v2 — Reserve-Funded On-Chain Refund

**Date:** 2026-07-06
**Status:** Approved, ready for implementation
**Goal:** Fix the known refund insolvency (ARCHITECTURE §3.5). Today `payForThread` pushes the 10% reserve out to an external `reservePool` address and never touches it; `refundThread` pays 100% refunds from the deployer EOA (which receives 0% of the split) — pure subsidy, unsustainable at scale. Make refunds provably reserve-funded: the contract custodies the reserve and pays refunds from it, hard-capped by the held balance.

## Economics

If refunds are sourced from the reserve, the system is solvent while the refund rate ≤ `reserveBp` (10%): the reserve receives 10% of every payment and pays out 100% per refund. For a reliable pipeline (refunds only on failed runs) 10% is adequate; `updateFeeSplit` can raise it later without a redeploy. The core defect is sourcing, not sizing.

## 1. Contract changes (`contracts/ShipPostPayment.sol`)

- **Retain the reserve in-contract.** `payForThread` transfers only `agentShare → agentWallet` and `treasuryShare → treasury`; `reserveShare` stays in the contract. `IERC20(token).balanceOf(address(this))` is the accumulated reserve per token. `reservePool` becomes vestigial for inflow; keep it only as an optional default withdraw destination (or drop it — see below).
- **`refund(uint256 threadId, address token, address to, uint256 amount) external onlyOwner nonReentrant`:**
  - `require(!refunded[threadId], "ALREADY_REFUNDED")`, then `refunded[threadId] = true` — on-chain idempotency, stronger than the off-chain-only `threads.refund_tx_hash` guard.
  - `require(IERC20(token).balanceOf(address(this)) >= amount, "RESERVE_INSUFFICIENT")`, then `safeTransfer(to, amount)`.
  - `emit Refunded(threadId, token, to, amount)`.
  - Hard cap: cannot pay more than the held reserve.
  - Callable when paused? Refund is a user-protective payout; like AgentWallet.emergencyWithdraw it should remain callable when paused (owner must always be able to make users whole). **Decision: refund is NOT gated by `whenNotPaused`.**
- **`withdrawReserve(address token, address to, uint256 amount) external onlyOwner`** — reclaim excess reserve (e.g. to treasury). No pause gate (owner reclaim).
- **`mapping(uint256 => bool) public refunded`** — per-thread refund flag.
- **Constructor `_startThreadId`.** ⚠️ Migration footgun: the live mainnet contract has ~32 threads (IDs 1..32) already recorded in Supabase under the unique index `(chain_id, onchain_thread_id)`. A fresh v2 counting from 1 re-emits colliding IDs → new `payForThread` inserts hit 23505 → 409 "already generated". Initialize `threadCounter = _startThreadId` (deploy with `100000`, safely past any existing ID).
- **Unchanged:** `Ownable`, `Pausable`, `ReentrancyGuard`, token whitelist, split math + basis-point setters, `requiredAmount`, `ThreadRequested`.

## 2. Off-chain changes

- **`refundThread` (`lib/agent/orchestrator.ts`):** replace the raw ERC20 `transfer` from the deployer EOA with a call to `ShipPostPayment.refund(threadId, token, to, amount)`, signed by the owner key (`DEPLOYER_PRIVATE_KEY` is the contract owner). Funds now leave the contract's reserve, not the deployer EOA.
  - Add an `onchainThreadId` parameter (both callers — `/api/refund` and `scripts/process-refund-request.ts` — already have it).
  - Pre-check reads the **contract's** token balance (reserve) for a clear "reserve drained" error instead of an opaque revert; keep the existing send-failure alert (#2).
- **`shipPostPaymentAbi` (`lib/contracts.ts`):** add `refund`, `withdrawReserve`, `refunded`, and the `Refunded` event.
- **Low-reserve alert:** extend the reconcile-cron heartbeat (#3) to also read the payment contract's reserve balance and page (throttled) when low. (Reuses `checkAgentWalletBalance`'s pattern; a sibling `checkReserveBalance` or a parameterized reader.)

## 3. Migration runbook (operator-executed — mainnet txs are not automatable here)

1. Deploy v2 to **Celo Sepolia first**; exercise pay → fail → refund end-to-end.
2. Deploy to **Celo mainnet**; update `NEXT_PUBLIC_PAYMENT_CONTRACT_{TESTNET,MAINNET}`, `lib/contracts.ts` addresses, README.
3. `setAllowedToken` for cUSD/USDT/USDC on the new contract.
4. **Seed initial reserve:** transfer a small stablecoin float into the new contract (reserve starts at 0; early refunds would fail until it accrues — users ≈ 0 so a small seed suffices).
5. Legacy threads (if any still pending on the old contract) refund via the old EOA path; users ≈ 0 so this is negligible. The old contract stays deployed but the app stops pointing new payments at it.

## 4. Testing

- **Hardhat (`test/contracts/ShipPostPayment.t.ts`):**
  - `payForThread` leaves `reserveShare` in the contract (agent + treasury still receive their shares).
  - `refund` pays `to` from the contract balance; reverts `RESERVE_INSUFFICIENT` when the reserve is too low.
  - `refund` is idempotent: a second call for the same `threadId` reverts `ALREADY_REFUNDED`.
  - `refund` / `withdrawReserve` are `onlyOwner`; `refund` still works while paused.
  - `withdrawReserve` moves reserve to the destination and cannot exceed the balance.
  - Constructor `_startThreadId` offsets `threadCounter`; the first `payForThread` emits `startThreadId + 1`.
  - `Refunded` event fields.
- **Off-chain:** `refundThread` calls `refund` with the right args and reads the contract balance for its pre-check; the #2 send-failure alert still fires on throw.

## Decisions (approved)

- On-chain `refunded[threadId]` idempotency guard: **yes**.
- `threadCounter` start offset: **100000**.
- Manual reserve seeding post-deploy: **yes**.
- `refund` callable while paused: **yes** (user-protective, mirrors `emergencyWithdraw`).

## Out of scope

- Raising `reserveBp` (available anytime via `updateFeeSplit`, no code change).
- Auto-sweeping stranded agent/treasury shares of failed threads back to reserve.
- Storing per-thread payer/amount on-chain for `refund` self-validation (owner is trusted; off-chain `verifyPayment` already binds payer/amount).
