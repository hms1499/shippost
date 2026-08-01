# Error-state mapping (spec §5 → code)

| Spec error | Detection | UX response | Component |
|---|---|---|---|
| Insufficient balance | `computeTokenAmount > balance` in EducationalInput / HotTakeInput | Inline message + link to `https://minipay.to` top-up | `ErrorSurface kind="insufficient"` |
| Token not approved | `usePayForThread` sees no allowance | Auto-trigger approve tx (Week 1 already does) | `usePayForThread` |
| Approve rejected or failed | `usePayForThread` throws while `errorPhase === 'approve'` | "Approval did not go through" + retry button | `ErrorSurface kind="approve-failed"` |
| Pay tx failed | `payForThread` reverts or the wallet throws (`errorPhase === 'pay'`) | "Payment failed — funds not moved" (no refund needed) | `ErrorSurface kind="pay-failed"` |
| Wallet never opened | `errorPhase === 'setup'` — no client, wrong chain, no RPC | "Wallet did not respond — nothing charged" | `ErrorSurface kind="wallet-unavailable"` |
| Pay outcome unknown | `errorPhase === 'confirm'` — receipt never arrived | "Payment not confirmed — check before retrying" (the one case where retry can double-charge) | `ErrorSurface kind="pay-unconfirmed"` |

The kind is chosen from the **recorded phase** (`PayPhase` in `lib/usePayForThread.ts`),
never by matching the wallet's wording, and every card prints the wallet's raw
message via `detail` — a payment failing inside the MiniPay webview leaves no
server-side trace, so that string is the only evidence of what happened.
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
