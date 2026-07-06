# Stuck-'pending' Reconciliation Sweeper — Design

**Date:** 2026-07-06
**Status:** Approved, ready for implementation
**Goal:** Close the acknowledged worst-state gap (ARCHITECTURE §3.4): a thread stuck in `threads.status='pending'` — payment taken, no content delivered, no automatic refund — when the pipeline dies by hard crash / SIGKILL / a DB write failure after spend, i.e. outside the 150s internal deadline's reach. A scheduled sweeper converts that invisible stuck state into a visible, queued refund.

## Decision

Sweeper **enqueues + alerts; it does not send money.** It reuses the existing, proven-safe refund queue (`refund_requests` → `pnpm refund:process`), which already has CAS locking, on-chain amount reads, and the `refund_tx_hash` single-source-of-truth guard. No new automated money-send path is introduced.

## Context (current mechanics)

- `threads.status` ∈ `pending | completed | failed` (free text, no CHECK). `failed` **is** the refundable state; there is no separate `refundable`.
- Refunds flow through the `refund_requests` queue table: `status ∈ pending|processing|completed|rejected`, `kind ∈ full|partial|slow-cancel`, unique index `(chain_id, onchain_thread_id, wallet_address, kind)`. `slow-cancel` means "the run never finished" — the exact semantics of a stuck-pending thread.
- The queue worker (`scripts/process-refund-request.ts`) does CAS `pending→processing`, reads the on-chain paid amount, guards on `threads.refund_tx_hash`, and never reverts to `pending` after a broadcast. That safety is unchanged and relied upon.
- No `vercel.json` and no cron exist yet. No alerting exists yet.

## Components

**1. `lib/agent/reconcile.ts` — pure, testable logic**
`reconcileStuckThreads(supabase, { thresholdMs, now, limit })`:
- Select `threads` where `status='pending'` AND `created_at < now − thresholdMs`, `LIMIT limit` (default 100 — runaway guard).
- Per row, **enqueue first, flip second**:
  1. Upsert `refund_requests(kind='slow-cancel', status='pending')`. The unique index makes reruns a no-op (no duplicates).
  2. CAS-flip `threads` `pending→failed` (update guarded by `.eq('status','pending')`).
- Collect per-row errors without aborting the batch. Return `{ swept, enqueued, errors }`.
- **Ordering rationale:** if enqueue succeeds and the flip crashes, the row stays `pending` → the next run re-scans it, the upsert is idempotent, and the flip retries. A `failed` row therefore always has its refund_request; a `failed` row is never missed (scan only targets `pending`).

**2. `app/api/cron/reconcile/route.ts` — cron endpoint**
- `runtime = 'nodejs'`. Auth: require `Authorization: Bearer $CRON_SECRET` (Vercel Cron injects this header). Missing/wrong → 401. Missing `CRON_SECRET` env → 500 (fail closed; never run unauthenticated).
- Call `reconcileStuckThreads`, then `alertOps(...)` when `swept > 0` or `errors.length > 0`. Return a JSON summary.

**3. `lib/alert.ts` — minimal ops alert (foundation for P0 #2)**
`alertOps(message, context?)` → POST to `ALERT_WEBHOOK_URL` (Slack/Discord-compatible JSON). Unset → `console.warn` only. Swallows all errors — a failed alert must never break the cron.

## Configuration

`vercel.json` (new):
```json
{ "crons": [{ "path": "/api/cron/reconcile", "schedule": "*/15 * * * *" }] }
```
Threshold **15 min**, well past `PIPELINE_DEADLINE_MS` (150s) + the 90s settle bound, so the serverless function is definitively dead — no risk of refunding an in-flight run. Cron frequency depends on the Vercel plan (Hobby is limited); the endpoint is also callable manually/externally.

## Safety invariants (preserved)

- **No double-refund:** idempotent upsert + the worker's `refund_tx_hash` guard + CAS `pending→processing`. The sweeper only queues; it never touches money.
- **No refund of a running thread:** 15-min threshold ≫ 150s deadline.
- **Fully idempotent:** two back-to-back cron runs produce the same state.
- **§3.5 caveat unchanged:** `slow-cancel` = full refund, consistent with existing behavior (not made worse). This is why recommendation #4 (reserve-funded refund) still matters.

## New env

- `CRON_SECRET` — required to authenticate the cron endpoint.
- `ALERT_WEBHOOK_URL` — optional ops webhook.

## Testing

- Unit `reconcile.test.ts` (mocked Supabase): selects only rows past the threshold; enqueues before flipping; idempotent on rerun; respects `limit`; a per-row error is collected without aborting the batch.
- Route `route.test.ts`: 401 on missing/wrong `CRON_SECRET`; 500 on unset env; on success calls reconcile and alerts when `swept>0`.
- `.env.example` documents `CRON_SECRET` + `ALERT_WEBHOOK_URL`.

## Out of scope

- Auto-settling the refund queue from the cron (unattended money-send) — deliberately deferred.
- Reserve-funded on-chain refund (recommendation #4).
- Full alerting suite (recommendation #2) — this only adds the `alertOps` primitive.
