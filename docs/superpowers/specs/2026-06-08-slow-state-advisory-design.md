# Slow-state coordination — advisory model (review cluster #1/#2)

Date: 2026-06-08
Status: approved

## Problem

The client stall-watchdog (`STALL_WATCHDOG_MS = 60s`, `useThreadGeneration.ts:59`)
and the server pipeline deadline (`PIPELINE_DEADLINE_MS = 150s`, `route.ts:40`)
are uncoordinated:

1. **UI dead-end.** On 60s of no-progress the client sets `fatal: 'slow'`. If
   the server then completes (`done`) before 150s, the `done` reducer keeps
   `fatal` set (`useThreadGeneration.ts:121-124`). The preview effect requires
   `!gen.fatal` (`HomeClient.tsx:232-237`) and the slow surface requires
   `!gen.isDone` (`HomeClient.tsx:495`) — so generated tweets are never shown
   and the user is stuck on the generating screen.
2. **Refund on a delivered thread.** The slow surface offers "Cancel + refund
   50%" which queues a `slow-cancel` refund request. The server keeps running
   (the button never aborts it — `route.ts:33-39`) and may complete + settle
   x402 + mark the thread `completed`. `refund-request` does not check status,
   so an operator can 50%-refund a successfully delivered thread. Money leak.
3. **Misleading "Cancel".** The button implies cancellation but aborts nothing.

## Decision

Make `slow` **advisory-only**. The server (its 150s deadline always resolves to
`done` or `fatal`) is the single authority on success/failure. The client never
declares an outcome the server disagrees with. No cancel button.

## Changes

### A. `hooks/useThreadGeneration.ts`
- Add `isSlow: boolean` to `ThreadGenerationState` (initial `false`).
- Extract the event reducer into a pure exported function
  `applyEvent(prev, event): ThreadGenerationState` so transitions are unit-testable
  without rendering the hook. The hook calls it inside `setState`.
- Watchdog fires → `isSlow: true` only if not already done/fatal. It no longer
  touches `fatal` or `isDone`. The `fatal: 'slow'` path is removed.
- Forward-progress events (`started`, `step_started`, `step_settled`,
  `step_output`) set `isSlow: false`.
- `done` and `fatal` set `isSlow: false`. `reset` returns to initial.

### B. `components/HomeClient.tsx`
- Remove the `gen.fatal === 'slow'` ErrorSurface block and the
  `requestRefund('slow-cancel')` call site.
- When `screen === 'generating' && gen.isSlow && !gen.isDone && !gen.fatal`,
  render a calm advisory note (no button): the agent is still running, funds are
  safe, an automatic refund follows on failure.
- `cap-hit` / `full-fail` / `partial` surfaces are unchanged (they key off the
  real server `gen.fatal`).

### C. `components/ErrorSurface.tsx`
- Remove the `'slow'` kind from `ErrorKind`, the `COPY.slow` entry, and from
  `isRefundKind`.

### D. `app/api/refund-request/route.ts`
- Defense in depth: if `kind === 'slow-cancel'` and `thread.status === 'completed'`,
  return 409 "thread already completed — not eligible for a cancel refund".
  Protects against stale clients. `partial` on a completed (degraded) thread
  remains valid and is untouched.

## Out of scope
- True server-side cancellation (AbortController plumbed through every step) —
  the deadline already bounds a hung run to 150s and routes it to a refundable
  `fatal`. Tracked separately (review #7).
- The dead `ErrorSurface 'insufficient'` kind (review P3).

## Testing
- New `hooks/useThreadGeneration.applyEvent` unit tests (vitest): slow set only
  when not done/fatal; progress clears slow; done/fatal clear slow; existing
  step/output/done/fatal transitions still hold.
- Extend `refund-request` route test (or add one) for the `slow-cancel` +
  `completed` → 409 guard if Supabase is mockable; otherwise verify by reading +
  `pnpm test:lib`.
- `pnpm build` + `pnpm lint` green. Playwright screenshot of the generating
  screen in the slow state (force `isSlow`).

## Files touched
- `hooks/useThreadGeneration.ts` (+ test)
- `components/HomeClient.tsx`
- `components/ErrorSurface.tsx`
- `app/api/refund-request/route.ts` (+ test if feasible)
