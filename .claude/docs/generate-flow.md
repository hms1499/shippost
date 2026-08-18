# Generate-flow invariants (agent rules)

> Canonical walkthrough: [`docs/ARCHITECTURE.md` §2.2](../../docs/ARCHITECTURE.md) (flow) and **Tầng 3** for the *why* of each invariant. This file is the short rule set — read it before editing `/api/generate/stream` or `lib/pipeline/`.

`/api/generate/stream` spends real cUSD per run, so its body is **hostile**. Hard rules:

- **Verify on-chain before any paid work.** `verifyPayment` (`lib/agent/orchestrator.ts`) decodes `ThreadRequested` from `payTxHash` and asserts threadId/payer/token/mode + `amount == requiredAmount`; route rejects with **402 before opening the stream**. Never trust `amountPaidRaw` — persist the verified amount. That `requiredAmount` read is **pinned to the payment's own `blockNumber`**, never head: the price is settable, so reading at head would let one `setPrice` reject every in-flight thread — money taken, nothing delivered. *Step-by-step: §3.1.*
- **One generation per payment.** Up-front `threads` insert runs **before** the stream: unique-violation (`23505`) → **409**; any other insert error → **503** fail-closed; both zero spend. Supabase-down is a documented degraded mode, not a bug to "fix".
- **Settle gates delivery.** `step_output` is emitted **only after** `settleX402Call` confirms, in both `groqStep` and `runModeB`. Never move the emit before settle — it reintroduces free-content-plus-refund. *Why: §3.2.* Soft steps (Serper, FactCheck) still settle on Celo; on Base they skip `executeX402Call` (`settlesSoftStepsOnChain`) because Groq already settles via Model 2 and the Base hop is only ETH to a simulated sink. Do not skip the Groq settle, including the legacy fallback.
- **Every failure is clean and refundable.** `boundThread`-validated (empty/junk → throw *before* settle, no spend); receipt waits bounded (90s); a hung run hits the internal **150s deadline** → `fatal` → thread `failed` → refundable (not a platform SIGKILL stuck `pending`). *Why 150s<300s: §3.4. Pipeline aborts on deadline so no settle after fatal: `5603fe9`.*
- **Retry, then escape hatch — never auto-refund.** Soft steps `retryOnce`, scoped to the external call only, never around settle. Still degraded → preview surfaces a one-tap `kind=partial` refund request. Auto partial-refund was deliberately rejected.
- **Cost display.** `X402_SINK_ADDRESS` overrides the default `0x…dead` burn sink (unset = burn, demo). Displayed cost derives from `GROQ_COST_CUSD` (single source) and cannot drift from what settles.

Soft (🟢) vs hard (🔴) step semantics and the thread state machine: §2.2.
