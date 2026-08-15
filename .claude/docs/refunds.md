# Refund operations (runbook)

> Canonical model + diagram: [`docs/ARCHITECTURE.md` §2.6](../../docs/ARCHITECTURE.md); funding model (reserve-funded, v2): §3.5; migration: [`docs/reserve-refund-migration.md`](../../docs/reserve-refund-migration.md). This file holds the operational recovery procedure not in that doc.

Two settlement paths, both call `refundThread` (`lib/agent/orchestrator.ts`): the admin endpoint `/api/refund` (one-off, `x-admin-key`) and the queue worker `pnpm refund:process <requestId>`.

**Invariant: `threads.refund_tx_hash` is the single source of truth — once set, that thread is paid out and must never be sent again.** Both paths refuse when it's already set.

Safety properties (don't regress):

- **Refund amount is read on-chain, from the thread's own `ThreadRequested` event** (`getOnChainPaidAmount({ chainId, payTxHash, threadId })`), never from client-supplied `threads.amount_paid_raw`. Partials capped at the on-chain paid amount.
  - It deliberately does **not** read `requiredAmount(token)`. That returns the price *now*, and the price is settable — a thread bought at $0.05 would be refunded at $0.10 and overdraw the reserve. Two prices already coexist in history (the Celo contract repriced on 2026-08-14), so this is live, not hypothetical.
  - Same reasoning binds anything else that values a past payment: `/api/public/analytics` sums each thread's `amount_paid_raw` rather than multiplying a count by a constant, and `verifyPayment`'s defence-in-depth price check reads `requiredAmount` **pinned to the payment's own block** — at head, one `setPrice` would reject every in-flight thread and take money without delivering.
- **The `refund_requests` lock is a compare-and-swap:** `refund:process` proceeds only if its `pending → processing` UPDATE touched exactly one row. Concurrent runs are safe.
- **A failed send never auto-reverts to `pending`** — the tx may have broadcast. The row is left `processing` with the error in `rejection_reason`.

## Recovering a row stuck in `processing` (send failed, on-chain state unknown)

1. Read `rejection_reason` on the `refund_requests` row.
2. Check the user's `wallet_address` on the explorer for that chain (`explorerBase(chainId)` — Basescan for Base, Celoscan for Celo) for an inbound transfer of the refund token around `processed_at`.
3. **If a transfer landed:** set `status = completed`, and set `refund_tx_hash` on **both** the `refund_requests` row and the parent `threads` row (the idempotency guard depends on the `threads` stamp).
4. **If no transfer landed:** fix the root cause (v2: commonly the **contract reserve drained** — `refundThread` reads `ShipPostPayment`'s own token balance and names the shortfall as `RESERVE_INSUFFICIENT`; top it up by sending the refund token to the payment contract address), then reset `status = pending` and re-run `pnpm refund:process <requestId>`.

**Never reset to `pending` without confirming on-chain that no transfer landed — that is the double-refund path.**

## Reserve state (check before trusting the refund path)

The reserve is per-contract: `ShipPostPayment` holds its own token balance and `refund()` is hard-capped by it. A redeployed contract starts at **zero** — it does not inherit the previous one's reserve, and there is no migration step that moves it.

As of 2026-08-14 both freshly deployed mainnet contracts hold **0** in every token, so `refund()` reverts `RESERVE_INSUFFICIENT` on both chains until seeded (`scripts/seed-reserve.ts`). The superseded Celo contract `0x0dea3241…` is also at 0. Until that is fixed, "every failure path is refundable" is not true in production — treat it as the gate before opening a chain to users.
