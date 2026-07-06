# Refund-failure Alerting — Design

**Date:** 2026-07-06
**Status:** Approved, ready for implementation
**Goal:** Wire the money-critical refund failure points — today only `console.error` — to a human via `alertOps`. Recommendation #2, scoped tight: refund-failure alerts only. AgentWallet balance detection/alerting is deferred to #3 (where the balance read already happens); daily-cap headroom is deferred.

## Instrumentation points

**1. `app/api/refund/route.ts` (deployed, admin one-shot) — two points:**

- **Sent-but-not-recorded (most severe).** After `refundThread` succeeds (money has left the wallet) but the Supabase `refund_tx_hash` stamp fails — both the `if (error)` branch and the surrounding `catch`. The DB then does not know the payout happened, so the cross-path idempotency guard is blind and a retry could double-send. Alert: `refund SENT but DB not stamped — double-send risk`, context `{ chainId, onchainThreadId, txHash, to }`.
- **Send failed (outer catch).** `refundThread` threw → on-chain state unknown (the transfer may or may not have broadcast). Alert: `refund send FAILED — verify on-chain before retry`, context `{ chainId, onchainThreadId, to, error }`. Response stays 502 (unchanged).

**2. `scripts/process-refund-request.ts` (local-only ops tool) — send-fail branch:** add `alertOps` to the existing "send failed, on-chain state UNKNOWN" catch. The script runs on the operator's machine, so the alert fires from there — still useful. The script already imports from `lib/`, so this is consistent; it stays out of CI/lint scope.

## Why no throttle

These are rare, always-page-a-human events. We want every occurrence, so no Redis dedup (throttling belongs to the recurring heartbeat in #3).

## Error handling

`alertOps` already swallows its own failures, so an alert can never change the route's outcome. Alerts are fired before returning the existing response; the HTTP status codes and bodies are unchanged.

## Testing

- New `app/api/refund/route.test.ts` (none exists today). Mock `refundThread`, `alertOps`, and `getSupabaseServer`:
  - `refundThread` rejects → 502 **and** `alertOps` called (send-fail).
  - `refundThread` resolves but the Supabase stamp returns an error → 200 (money already sent) **and** `alertOps` called (double-send-risk).
  - `refundThread` resolves + stamp OK → **no** alert.
  - Existing guards (401 unauthenticated, 409 already-refunded) still hold.
- Script: add the alert, no forced unit test (local-only, outside CI — consistent with repo convention).

## Out of scope

- AgentWallet balance detection + low-balance alert → recommendation #3.
- Daily-cap headroom alert → deferred.
- No new env (reuses `ALERT_WEBHOOK_URL`).
