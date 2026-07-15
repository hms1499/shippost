# Model 2 x402 — Layered proof on prod (design)

Date: 2026-07-15
Status: approved (design)

## Problem

Model 2 (real x402: route every paid thread's Groq spend through `/api/x402/groq`
→ CDP facilitator → USDC settles on **Base**) has been live in code since
2026-07-08 but is **unproven on production by a real paid thread**. The endpoint
itself was proven by a direct smoke test on Base mainnet (2026-06-03), but that
driver (`scripts/x402-smoke.ts`) calls `payGroqViaX402` directly and **bypasses
the pipeline's `getSettleMode()` decision** — so it never proves that a real
user-paid thread through `/api/generate/stream` actually *chooses* the x402 path
and settles on Base rather than silently degrading to legacy (the exact failure
the Upstash prod-env gap caused until 2026-07-13).

### Root finding

The `threads` table persists `groq_tx_hash` but **not the settle chain**. A row's
`chain_id` column is the *payment* chain (Celo); the Groq x402 settle lands on
**Base**. A bare tx-hash string cannot be classified as Base vs Celo. The
`step_settled` event for the groq step **already carries `chainId`** (Base 8453
in x402 mode, `undefined` in legacy — see `lib/pipeline/types.ts`,
`lib/pipeline/generateDraft.ts`), but `app/api/generate/stream/route.ts` captures
only `txHash` and discards the chain. So today there is no *positive* signal in
the data to prove a thread settled via x402. Absence of the "fell back to legacy"
alert is not proof.

## Goal

Turn "unproven" into a **repeatable, positive check**, then light it green with a
single real paid thread — and leave the tooling in place for ongoing checks.

## Approach — 3 small commits, sequential

### Commit 1 — migration `supabase/migrations/0008_groq_settle_chain.sql`
```sql
alter table public.threads
  add column if not exists groq_settle_chain_id int;
```
Nullable. Pre-existing rows stay `null` = "pre-audit, unknown" — we do not
pretend to know their settle chain.

### Commit 2 — persist the settle chain in `app/api/generate/stream/route.ts` (+ test)
When capturing the groq `step_settled` event, also record its chain, writing
`groq_settle_chain_id = e.chainId ?? body.chainId` in **both** the success and
failure `threads` updates. This disambiguates cleanly:

- `8453` (or `84532`) → x402 settled on **Base** ✅
- `42220` / `11142220` → legacy settled on **Celo**
- `null` → row predates the audit column (unknown)

Legacy's groq `step_settled` carries `chainId: undefined`, so the `?? body.chainId`
fallback stamps the Celo payment chain — which is where the legacy settle actually
happens — keeping "legacy" distinct from "pre-audit null".

Add a route test asserting the new column is persisted with the settle chain from
the groq `step_settled` event (x402 → 8453; legacy → payment chain).

### Commit 3 — audit script `scripts/x402-audit.ts` (local-only tool)
Same class as the other `scripts/` ops utilities — **not** deployed, kept out of
lint/CI/deploy scope. Reads the last N `completed` threads via
`getSupabaseServer()` and prints a per-thread table:

```
created_at · mode · onchain_thread_id · groq_tx_hash (basescan link if Base) · verdict
```

Verdict per row from `groq_settle_chain_id`:
- `8453`/`84532` → `x402 ✅ (Base)`
- `42220`/`11142220` → `legacy (Celo)`
- `null` → `pre-audit (unknown)`

Summary line: `X/N recent completed threads settled Groq via x402 on Base.`
Exit non-zero when the most-recent completed thread is not x402, so the script is
usable as a verification gate.

## Proof sequence

1. Run `x402-audit.ts` against prod now → baseline (expected: all legacy/null
   pre-migration).
2. Deploy migration + route change.
3. **User** pays one real thread on MiniPay (~0.05 cUSD). This settles via x402
   **only if** prod env has `X402_SETTLE_MODE=x402` + `X402_CHAIN_ID=8453` **and**
   the agent EOA is funded with ETH + USDC on Base. The audit will expose a silent
   fallback if any of those is missing.
4. Run `x402-audit.ts` again → the new thread shows `x402 ✅ (Base)` with a
   basescan link → Model 2 proven; tooling remains for ongoing checks.

## Alternatives considered (rejected)

- **On-chain probe** (query each `groq_tx_hash` on Base vs Celo RPC): no schema
  change and works retroactively, but indirect, RPC-heavy, and leaves no durable
  self-reported signal. Rejected as the primary mechanism (YAGNI); could later be
  a fallback classifier for `null` rows.
- **Run the endpoint smoke on prod only**: rejected — proves the endpoint half,
  not that a real thread's `generateDraft` chooses x402.

## Testing

- Commit 2: Vitest route test for the new column persistence (x402 and legacy).
- Commit 3: audit script is a local ops tool — no CI coverage, consistent with
  the rest of `scripts/`.
- Full suite (`pnpm test:lib`) stays green.

## Out of scope

- Retroactive classification of pre-migration rows.
- Any change to the settle path itself, the fallback/alert logic, or the x402
  endpoint. This work only *observes* — it never moves a `step_output` emit
  relative to its settle.
