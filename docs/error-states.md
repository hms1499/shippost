# Error-state mapping (spec §5 → code)

| Spec error | Detection | UX response | Component |
|---|---|---|---|
| Insufficient balance | `computeTokenAmount > balance` in EducationalInput / HotTakeInput | Inline message + link to `https://minipay.to` top-up | `ErrorSurface kind="insufficient"` |
| Token not approved | `usePayForThread` sees no allowance | Auto-trigger approve tx (Week 1 already does) | `usePayForThread` |
| Approve rejected | `approve` tx throws | "Cancelled. Try again?" with retry button | `ErrorSurface kind="approve-rejected"` |
| Pay tx failed | `payForThread` reverts or tx fails | "Payment failed — funds not moved" (no refund needed) | `ErrorSurface kind="pay-failed"` |
| x402 fails mid-pipeline | `step_failed` emitted, but `tweets` exist (partial output) | "Partial output saved. We'll refund the failed step within 24h." | `ErrorSurface kind="partial"` |
| All x402 fail | `fatal` event with no tweets | "Generation failed — full refund in progress." + request refund CTA | `ErrorSurface kind="full-fail"` |
| Agent bucket empty | Orchestrator catches `DailySpendCapExceeded` revert | Pause app UI + "We ran out of budget today, back tomorrow" | `ErrorSurface kind="cap-hit"` (global banner) |
| Generation >60s | Client-side timeout in `useThreadGeneration` | Inline "Still working… cancel? (50% refund)" | `ErrorSurface kind="slow"` |

## Refund mechanics (MVP)

Per Week 3 spec, the refund CTA on `partial` / `full-fail` / `slow` currently surfaces an
acknowledgement message. The operator drives actual refunds via the
`POST /api/refund` admin endpoint or `pnpm refund` CLI script (see Task 12).
Week 4 may wire a self-serve dispute UI.

## Slow-watchdog sentinel

`useThreadGeneration` sets `fatal = "slow"` after 60s without `done`. The page treats that
as a non-terminal state — the stream may still complete; user just gets the option to
bail. On real failures (`fatal` event from server) `fatal` is set to the actual error
message, never the literal `"slow"`.
