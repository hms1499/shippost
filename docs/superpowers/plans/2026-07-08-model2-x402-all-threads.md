# Model 2 — real x402 for every paid thread — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route the Groq settlement of every paid thread through real x402 on Base (agent signs `X-Payment`, CDP facilitator settles USDC), decoupled from the user's Celo payment chain, with a legacy fallback on infra failure.

**Architecture:** Flip `getSettleMode()` from payment-chain-keyed to env-global (`X402_SETTLE_MODE` + `X402_CHAIN_ID`). `generateDraft` tries `payGroqViaX402` first and falls back to the existing legacy push-to-sink on infra errors (never after abort). The settle chainId rides the `step_settled` event so the UI links each tx to its own explorer (Basescan for Groq, Celoscan for everything else).

**Tech Stack:** Next.js 14 App Router, viem, `@x402/{fetch,next}`, CDP facilitator, Vitest 4, pnpm.

**Spec:** `docs/superpowers/specs/2026-07-08-model2-x402-all-threads-design.md`

## Global Constraints

- **Settle gates delivery** — never emit `step_output` before its settle; never settle after the run's AbortSignal fired (run is already fatal + refundable).
- Payment verification (`payTxHash` decode) is untouched — this plan never touches `/api/generate/stream` verification, `ShipPostPayment`, or refunds.
- Fail-safe config: bad/missing `X402_CHAIN_ID` degrades to `'legacy'`, never throws at import time.
- Tests: Vitest colocated (`foo.ts` → `foo.test.ts`); run with `npx vitest run <file>`; full suite `pnpm test:lib` must stay green (330+ tests).
- Commit each task directly to `main` (trunk-based, no branches), message style `feat(x402): …` / `test: …` / `docs: …`, ending with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- `scripts/` stays out of lint/CI/deploy scope.
- Comments state constraints, not narration; match surrounding density.

---

### Task 1: Decouple settle mode from the payment chain

**Files:**
- Modify: `lib/x402/config.ts:48-52` (replace `getSettleMode`, add `getSettleChainId`)
- Modify: `lib/pipeline/generateDraft.ts` (call sites)
- Test: `lib/x402/config.test.ts`, `lib/pipeline/generateDraft.test.ts`

**Interfaces:**
- Produces: `getSettleMode(): SettleMode` (no args) and `getSettleChainId(): number` from `@/lib/x402/config`. Tasks 2–3 rely on exactly these signatures.

- [ ] **Step 1: Write the failing tests**

In `lib/x402/config.test.ts`, replace the `'uses x402 only when flag=x402 AND chain is Base'` test with:

```ts
  it('x402 only when flag=x402 AND X402_CHAIN_ID is a supported Base chain', () => {
    vi.stubEnv('X402_SETTLE_MODE', 'x402');
    vi.stubEnv('X402_CHAIN_ID', '8453');
    expect(getSettleMode()).toBe('x402');
    expect(getSettleChainId()).toBe(BASE);

    vi.stubEnv('X402_CHAIN_ID', String(CELO)); // flag on, non-Base settle chain
    expect(getSettleMode()).toBe('legacy');

    vi.stubEnv('X402_CHAIN_ID', 'garbage'); // flag on, unparseable
    expect(getSettleMode()).toBe('legacy');
  });

  it('legacy when the flag is off, whatever the settle chain', () => {
    vi.stubEnv('X402_SETTLE_MODE', 'legacy');
    vi.stubEnv('X402_CHAIN_ID', '8453');
    expect(getSettleMode()).toBe('legacy');
  });
```

Add `getSettleChainId` to the import at the top of the file.

In `lib/pipeline/generateDraft.test.ts`:
- extend the config mock (line 8) to `vi.mock('@/lib/x402/config', () => ({ getSettleMode, getSettleChainId, X402_PRICE_USD: '0.001', GROQ_MODEL: 'llama-3.3-70b-versatile' }));` with `const getSettleChainId = vi.fn();` declared next to the other fns (line 3);
- in `beforeEach`, add `getSettleChainId.mockReturnValue(8453);`
- change the shared ctx (line 15) to a **Celo** payment chain: `chainId: 42220` — this is the point of the feature;
- add to the first x402 test (after the `settleX402Call` assertion):

```ts
    // Decoupling: payment chain is Celo, settle chain comes from env config.
    expect(payGroqViaX402).toHaveBeenCalledWith(expect.objectContaining({ chainId: 8453 }));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/x402/config.test.ts lib/pipeline/generateDraft.test.ts`
Expected: FAIL — `getSettleChainId` is not exported / `getSettleMode()` still expects an argument.

- [ ] **Step 3: Implement**

In `lib/x402/config.ts`, replace the existing `getSettleMode` (lines 46-52) with:

```ts
// x402 only when explicitly enabled AND the settlement chain (X402_CHAIN_ID)
// is a supported Base chain; everything else stays legacy. Deliberately NOT
// keyed on the user's payment chain: MiniPay users pay on Celo while the
// agent's own Groq spend settles on Base (Model 2, spec
// docs/superpowers/specs/2026-07-08-model2-x402-all-threads-design.md).
export function getSettleMode(): SettleMode {
  return process.env.X402_SETTLE_MODE === 'x402' && isX402Chain(getSettleChainId())
    ? 'x402'
    : 'legacy';
}

// The chain the agent's x402 spend settles on — NOT the payment chain. NaN
// when X402_CHAIN_ID is unset/garbage; isX402Chain(NaN) is false, so the mode
// degrades to legacy instead of throwing.
export function getSettleChainId(): number {
  return Number(process.env.X402_CHAIN_ID);
}
```

In `lib/pipeline/generateDraft.ts`:
- import line 5 becomes `import { getSettleMode, getSettleChainId, X402_PRICE_USD, GROQ_MODEL } from '@/lib/x402/config';`
- line 47: `if (getSettleMode() === 'x402') {`
- line 49: `chainId: getSettleChainId(),`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/x402/config.test.ts lib/pipeline/generateDraft.test.ts` → PASS, then `pnpm test:lib` → all green, then `npx tsc --noEmit` → exit 0. (`getSettleMode` has no other production call sites — verify with `grep -rn "getSettleMode" app lib --include="*.ts" | grep -v test`.)

- [ ] **Step 5: Commit**

```bash
git add lib/x402/config.ts lib/x402/config.test.ts lib/pipeline/generateDraft.ts lib/pipeline/generateDraft.test.ts
git commit -m "feat(x402): settle mode decoupled from payment chain — X402_CHAIN_ID picks the settle rail"
```

---

### Task 2: x402-first fallback to legacy on infra failure

**Files:**
- Modify: `lib/pipeline/generateDraft.ts` (restructure the x402 branch)
- Test: `lib/pipeline/generateDraft.test.ts`

**Interfaces:**
- Consumes: `getSettleMode()` / `getSettleChainId()` from Task 1; `alertOps(message: string, context?: object): Promise<void>` from `@/lib/alert` (exists, never throws, degrades to console.warn without `ALERT_WEBHOOK_URL`).
- Produces: `generateDraft` behavior contract — x402 infra error ⇒ legacy result (`tokenSymbol: 'cUSD'`) + one `alertOps` call; abort ⇒ rethrow with **no** settle of any kind.

- [ ] **Step 1: Write the failing tests**

In `lib/pipeline/generateDraft.test.ts`, add `const alertOps = vi.fn().mockResolvedValue(undefined);` next to the other mock fns and `vi.mock('@/lib/alert', () => ({ alertOps }));` next to the other `vi.mock` calls. Add to the `generateDraft` describe block:

```ts
  it('x402 infra failure falls back to the legacy settle and alerts ops', async () => {
    getSettleMode.mockReturnValue('x402');
    payGroqViaX402.mockRejectedValue(new Error('facilitator 503'));
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hi\n\n2/ there' } }] });
    settleX402Call.mockResolvedValue('0xsink');
    const out = await generateDraft(ctx, msgs);
    expect(out.tokenSymbol).toBe('cUSD'); // legacy result, user still gets the thread
    expect(out.txHash).toBe('0xsink');
    expect(settleX402Call).toHaveBeenCalledOnce();
    expect(alertOps).toHaveBeenCalledOnce();
    expect(alertOps.mock.calls[0][0]).toMatch(/fell back/i);
  });

  it('x402 failure after the deadline fired rethrows — no legacy settle, no alert-then-spend', async () => {
    getSettleMode.mockReturnValue('x402');
    const ac = new AbortController();
    payGroqViaX402.mockImplementation(async () => {
      ac.abort(); // deadline fires mid-settle
      throw new Error('aborted: generation deadline exceeded');
    });
    await expect(generateDraft({ ...ctx, signal: ac.signal }, msgs)).rejects.toThrow(/abort/i);
    expect(create).not.toHaveBeenCalled();
    expect(settleX402Call).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/pipeline/generateDraft.test.ts`
Expected: FAIL — first test rejects with `facilitator 503` instead of falling back.

- [ ] **Step 3: Implement**

In `lib/pipeline/generateDraft.ts`, add `import { alertOps } from '@/lib/alert';` and replace the body of the `if (getSettleMode() === 'x402') { … }` block so the whole function reads:

```ts
export async function generateDraft(ctx: PipelineContext, input: DraftInput): Promise<DraftResult> {
  throwIfAborted(ctx.signal);

  if (getSettleMode() === 'x402') {
    try {
      const { tweets, settlementTxHash } = await payGroqViaX402({
        chainId: getSettleChainId(),
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        // Forward the deadline so a timeout mid-proxy-call cancels before settle,
        // mirroring the legacy path's re-check right before settleX402Call.
        signal: ctx.signal,
      });
      return {
        tweets,
        txHash: (settlementTxHash || '0x0') as Hex,
        costHuman: X402_PRICE_USD,
        tokenSymbol: 'USDC',
      };
    } catch (e) {
      // Deadline fired: the run is already fatal + refundable — never settle
      // anything after that, in either mode.
      if (ctx.signal?.aborted) throw e;
      // Infra failure (facilitator down, cap hit, paused, empty float, proxy
      // 5xx): degrade to the legacy settle below so a paid user still gets
      // their thread. Alert is fire-and-forget; alertOps never throws.
      void alertOps('x402 settle fell back to legacy', {
        threadId: ctx.threadId.toString(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // legacy: call Groq directly, validate, then push-to-sink in cUSD.
  // Also the x402 infra-failure fallback path.
  const tweets = await generateTweets(input);
  // Re-check: the deadline may have fired while Groq was responding. Never
  // settle (spend) after the run is already considered failed.
  throwIfAborted(ctx.signal);
  const txHash = await settleX402Call({
    chainId: ctx.chainId,
    serviceAddress: GROQ_SINK,
    tokenSymbol: 'cUSD',
    amount: GROQ_COST_CUSD,
    threadId: ctx.threadId,
  });
  return { tweets, txHash, costHuman: GROQ_COST_HUMAN, tokenSymbol: 'cUSD' };
}
```

(The accepted $0.002 double-settle edge — proxy settled but the response was lost — is documented in the spec §2; no dedup here.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/pipeline/generateDraft.test.ts` → PASS (all 11), then `pnpm test:lib` → green.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/generateDraft.ts lib/pipeline/generateDraft.test.ts
git commit -m "feat(x402): x402-first Groq settle with alerted legacy fallback on infra failure"
```

---

### Task 3: Settle chainId rides the step_settled event

**Files:**
- Modify: `lib/pipeline/types.ts:14` (`step_settled` union member)
- Modify: `lib/pipeline/generateDraft.ts` (`DraftResult` + x402 return)
- Modify: `lib/pipeline/groqStep.ts:34-40`, `lib/pipeline/runModeB.ts:107-113` (emit sites)
- Modify: `lib/threadGeneration.ts` (`StepState`, `applyEvent`)
- Test: `lib/pipeline/generateDraft.test.ts`, `lib/threadGeneration.test.ts`, `lib/pipeline/runModeB.test.ts`

**Interfaces:**
- Consumes: `DraftResult` from Task 2.
- Produces: `PipelineEvent` `step_settled` gains `chainId?: number`; `DraftResult` gains `chainId?: number` (set only on the x402 path); `StepState` gains `chainId?: number`. Task 4 reads `StepState.chainId`.

- [ ] **Step 1: Write the failing tests**

`lib/pipeline/generateDraft.test.ts` — extend the first x402 test's `toEqual` to `{ tweets: ['a', 'b'], txHash: '0xtx', costHuman: '0.001', tokenSymbol: 'USDC', chainId: 8453 }`, and add to the legacy-mode test: `expect(out.chainId).toBeUndefined();`.

`lib/threadGeneration.test.ts` — in the `'step_settled records txHash/cost/symbol'` test (line 62), add `chainId: 8453` to the applied event object and `expect(s.steps.groq.chainId).toBe(8453);` next to the existing assertions (match the local variable naming already used in that test).

`lib/pipeline/runModeB.test.ts` — in `beforeEach`, add `chainId: 8453` to the `generateDraft.mockResolvedValue({ … })` object, and add this test to the default-behaviour describe block:

```ts
  it('forwards the settle chainId on the groq step_settled event', async () => {
    const events: PipelineEvent[] = [];
    await runModeB(
      { ...baseCtx, angle: 'skeptical', eventDescription: 'evt' },
      (e) => events.push(e),
    );
    const settled = events.find((e) => e.type === 'step_settled' && e.step === 'groq');
    expect(settled).toMatchObject({ chainId: 8453 });
  });
```

(Import `type { PipelineEvent } from './types'` if the file doesn't already.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/pipeline/generateDraft.test.ts lib/threadGeneration.test.ts lib/pipeline/runModeB.test.ts`
Expected: FAIL — `chainId` missing from results/events/state.

- [ ] **Step 3: Implement**

`lib/pipeline/types.ts` — the `step_settled` member becomes:

```ts
  | { type: 'step_settled'; step: StepId; txHash: Hex; costAmount: string; tokenSymbol: 'cUSD' | 'USDT' | 'USDC'; chainId?: number }
```

(`chainId` = the chain the settle tx landed on; absent ⇒ consumers fall back to the payment chain.)

`lib/pipeline/generateDraft.ts` — `DraftResult` gains `chainId?: number;` (doc: settle chain when it differs from the payment chain — x402 path only). The x402 `return` adds `chainId: getSettleChainId(),` — hoist `const settleChainId = getSettleChainId();` above the `try` and use it for both the `payGroqViaX402` arg and the return so they cannot diverge.

`lib/pipeline/groqStep.ts` — the `step_settled` emit adds `chainId: draft.chainId,`.

`lib/pipeline/runModeB.ts` — the `wrappedEmit({ type: 'step_settled', … })` for groq adds `chainId: draft.chainId,`.

`lib/threadGeneration.ts` — `StepState` gains `chainId?: number;`; in `applyEvent`'s `step_settled` case add `chainId: e.chainId,` to the spread.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/pipeline lib/threadGeneration.test.ts` → PASS, `pnpm test:lib` green, `npx tsc --noEmit` exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/types.ts lib/pipeline/generateDraft.ts lib/pipeline/generateDraft.test.ts lib/pipeline/groqStep.ts lib/pipeline/runModeB.ts lib/pipeline/runModeB.test.ts lib/threadGeneration.ts lib/threadGeneration.test.ts
git commit -m "feat(x402): step_settled carries the settle chainId (Base ≠ payment chain)"
```

---

### Task 4: Per-row explorer links in trace + receipt

**Files:**
- Modify: `lib/chains.ts:23-26` (`explorerBase` Base entries)
- Create: `lib/chains.test.ts`
- Modify: `lib/traceLog.ts` (`TraceLine.chainId`), `lib/receiptText.ts` (`X402Call.chainId`)
- Modify: `components/AgentTrace.tsx:139`, `components/PostShareScreen.tsx:129`
- Test: `lib/chains.test.ts`, `lib/traceLog.test.ts`, `lib/receiptText.test.ts`

**Interfaces:**
- Consumes: `StepState.chainId` from Task 3; `explorerBase(chainId: number | undefined): string` from `lib/chains.ts`.
- Produces: `TraceLine` and `X402Call` each gain `chainId?: number`. UI rule everywhere: `row.chainId !== undefined ? explorerBase(row.chainId) : <payment-chain explorer prop>`.

- [ ] **Step 1: Write the failing tests**

Create `lib/chains.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { explorerBase } from './chains';

describe('explorerBase', () => {
  it('maps payment and settle chains to their explorers', () => {
    expect(explorerBase(42220)).toBe('https://celoscan.io');
    expect(explorerBase(8453)).toBe('https://basescan.org');
    expect(explorerBase(84532)).toBe('https://sepolia.basescan.org');
    expect(explorerBase(11142220)).toBe('https://celo-sepolia.blockscout.com');
    expect(explorerBase(undefined)).toBe('https://celo-sepolia.blockscout.com');
  });
});
```

`lib/traceLog.test.ts` — find the existing settled-line test and add `chainId` to the settled step state it builds plus `expect(line.chainId).toBe(8453);` on the produced line (mirror that file's existing helper/naming; the step state now carries `chainId: 8453`).

`lib/receiptText.test.ts` — in the existing `settledCalls` test, add `chainId: 8453` to a settled groq `StepState` and assert the returned call object includes it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/chains.test.ts lib/traceLog.test.ts lib/receiptText.test.ts`
Expected: FAIL — Base URLs unknown; `chainId` dropped by `appendTraceLines`/`settledCalls`.

- [ ] **Step 3: Implement**

`lib/chains.ts` — replace `explorerBase` with:

```ts
export function explorerBase(chainId: number | undefined): string {
  if (chainId === celo.id) return 'https://celoscan.io';
  if (chainId === 8453) return 'https://basescan.org'; // Base — x402 settle rail
  if (chainId === 84532) return 'https://sepolia.basescan.org';
  return 'https://celo-sepolia.blockscout.com';
}
```

`lib/traceLog.ts` — `TraceLine` gains `chainId?: number;`; the `settled` push adds `chainId: n.chainId,`.

`lib/receiptText.ts` — `X402Call` gains `chainId?: number;`; `settledCalls` push adds `chainId: s.chainId,`.

`components/AgentTrace.tsx` — add `import { explorerBase } from '@/lib/chains';` and change line 139 to:

```tsx
            <LogRow glyph={l.glyph} text={l.text} amount={l.amount} txHash={l.txHash} explorer={l.chainId !== undefined ? explorerBase(l.chainId) : chainExplorerBase} />
```

(The payment row at line 131 keeps `chainExplorerBase` — payment is always the user's chain.)

`components/PostShareScreen.tsx` — add `import { explorerBase as explorerBaseFor } from '@/lib/chains';` (aliased: the component already has a string prop named `explorerBase`) and change the per-call ledger line (line 129) to:

```tsx
                  txHref={c.txHash ? `${c.chainId !== undefined ? explorerBaseFor(c.chainId) : explorerBase}/tx/${c.txHash}` : undefined}
```

`buildReceiptText` (plain-text receipt) prints no per-call links — unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/chains.test.ts lib/traceLog.test.ts lib/receiptText.test.ts` → PASS, `pnpm test:lib` green, `pnpm lint` clean, `npx tsc --noEmit` exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/chains.ts lib/chains.test.ts lib/traceLog.ts lib/traceLog.test.ts lib/receiptText.ts lib/receiptText.test.ts components/AgentTrace.tsx components/PostShareScreen.tsx
git commit -m "feat(ui): per-row explorer links — Groq x402 settle links Basescan, rest stay Celo"
```

---

### Task 5: Documentation updates

**Files:**
- Modify: `.claude/docs/x402.md` (Model 1/2 bullets)
- Modify: `docs/ARCHITECTURE.md` §2.3 (final two paragraphs of the section)
- Modify: `docs/x402-mainnet-proof.md` ("What's live vs what's proven" + "Next step — Model 2" sections)

**Interfaces:** none (prose only). Keep `docs/ARCHITECTURE.md` in Vietnamese, the other two in English, matching each file's existing language.

- [ ] **Step 1: Update `.claude/docs/x402.md`**

Replace the Model 1 bullet with:

```markdown
- **Model 1 — Celo, in-process (we BUY services).** Pipeline steps (`lib/pipeline/*Step.ts`) simulate x402 by pulling stablecoin from **AgentWallet** via `settleX402Call` → cap-enforced `executeX402Call` on Celo. Since Model 2 went live this covers Serper/CoinGecko/FactCheck — and the **Groq fallback** when the x402 rail is down (`generateDraft` alerts ops and degrades here).
```

Replace the Model 2 bullet with:

```markdown
- **Model 2 — real x402 (live for every paid thread's Groq settle).** `generateDraft` routes the Groq spend through `payGroqViaX402` → `app/api/x402/groq/route.ts` (`withX402` + CDP facilitator): the agent EOA signs an EIP-3009 `X-Payment`, USDC settles on **Base** to `X402_PAY_TO`. Enabled by `X402_SETTLE_MODE=x402` + `X402_CHAIN_ID` (global — deliberately NOT keyed on the user's payment chain; users stay on Celo). Verify-before-handler, settle-only-after-200. Proven on Base mainnet 2026-06-03.
```

- [ ] **Step 2: Update `docs/ARCHITECTURE.md` §2.3**

Replace the paragraph beginning `**Model 1** là luồng generate per-thread` (and keep the history paragraph after it) with:

```markdown
**Model 1** giờ là đường settle của Serper/CoinGecko/FactCheck — và là **fallback** cho Groq khi
đường x402 gặp sự cố hạ tầng (CDP down, đụng cap, hết float): `generateDraft` bắn Discord alert rồi
rơi êm về push-to-sink, user vẫn nhận thread. **Model 2** từ 2026-07 là đường chính của Groq cho
**mọi** thread trả phí: `getSettleMode()` đọc `X402_SETTLE_MODE` + `X402_CHAIN_ID` từ env (tách
khỏi chain thanh toán — user vẫn trả cUSD trên Celo), agent EOA ký `X-Payment`, CDP facilitator
settle USDC trên Base về `X402_PAY_TO`, **không chạm AgentWallet**. `step_settled` mang `chainId`
để UI link đúng Basescan cho tx groq. Rollback: đổi env, hoặc tức thời `redis set x402:paused 1`
(= fallback về Model 1, không phải outage).
```

- [ ] **Step 3: Update `docs/x402-mainnet-proof.md`**

In "What's live vs what's proven", replace the second bullet and the closing line with:

```markdown
- **Live since 2026-07 (Model 2):** every paid thread's Groq settlement routes
  through this x402 rail regardless of where the user paid. MiniPay users still
  pay 0.05 cUSD on Celo; `getSettleMode()` is env-global (`X402_SETTLE_MODE` +
  `X402_CHAIN_ID`), no longer keyed on the payment chain. Infra failures degrade
  to the audited legacy push-to-sink with a Discord alert — x402-first, never
  thread-loss.
```

Replace the entire "Next step — Model 2" section (heading included) with:

```markdown
## Model 2 — shipped

Implemented 2026-07-08 (spec:
`docs/superpowers/specs/2026-07-08-model2-x402-all-threads-design.md`). The
settle layer is selected by env (`X402_SETTLE_MODE=x402` + `X402_CHAIN_ID=8453`),
decoupled from the payment chain. The agent EOA keeps a small manual USDC float
on Base; the Redis `x402:paused` switch now means "fall back to legacy", making
it a no-deploy rollback lever.
```

- [ ] **Step 4: Verify and commit**

Run: `pnpm lint` (docs don't affect it — sanity only) and re-read the three diffs for contradictions with the code shipped in Tasks 1–4.

```bash
git add .claude/docs/x402.md docs/ARCHITECTURE.md docs/x402-mainnet-proof.md
git commit -m "docs(x402): Model 2 live — settle rail decoupled from payment chain, fallback semantics"
```

---

### Task 6: Rollout — env, float, smoke, flag flip, real run

**This task is interactive ops, not code.** Steps 2–3 need values only the user holds (CDP keys, treasury address, USDC to send). Nothing before step 4 changes production behavior.

**Files:**
- None in-repo (env + on-chain funding + verification). `scripts/x402-smoke.ts` already exists.

- [ ] **Step 1: Deploy Tasks 1–5 with the flag off**

Push `main`; confirm the Vercel deploy is green. Prod has no `X402_SETTLE_MODE`, so every thread still settles legacy — zero behavior change. Verify with one preview-env or prod thread if in doubt.

- [ ] **Step 2 (USER): Fund the float**

Send **~$2 USDC on Base mainnet** to the agent EOA `0x64Ad61211C1b0B7f20B3e04B49661f30f152ae78` (current balance ≈ 0.0056 USDC ⇒ ~5 threads). $2 ≈ 2000 threads at $0.001.

- [ ] **Step 3 (USER + agent): Set prod env via Vercel REST API**

CLI stdin on v54 stores `""` (known issue — ALERT_WEBHOOK_URL incident 2026-07-07); use the REST upsert instead. For each var: `X402_SETTLE_MODE=x402`, `X402_CHAIN_ID=8453`, `X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402`, `CDP_API_KEY_ID=<user>`, `CDP_API_KEY_SECRET=<user>`, `X402_PAY_TO=0x66f744Af7B1D1218031C83Cb2c62EBa7e6138eD8` (treasury from the proof run — user confirms), `X402_PROXY_BASE_URL=https://shippost.app`, `X402_DAILY_CAP_USDC=5`:

```bash
TOKEN=$(jq -r .token ~/.local/share/com.vercel.cli/auth.json 2>/dev/null || jq -r .token ~/.vercel/auth.json)
PROJECT_ID=$(jq -r .projectId .vercel/project.json)
curl -sS -X POST "https://api.vercel.com/v10/projects/$PROJECT_ID/env?upsert=true" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"key":"X402_SETTLE_MODE","value":"x402","type":"encrypted","target":["production"]}'
```

(Repeat per var; secrets use `"type":"sensitive"`. After the last one, redeploy so the runtime picks them up. Then `vercel env ls production` to confirm no empty values — sensitive vars pull as `""` by design, check via the dashboard.)

- [ ] **Step 4: Smoke the prod rail (spends 0.001 USDC)**

Locally, with the same env values pointed at prod:

```bash
X402_PROXY_BASE_URL=https://shippost.app X402_CHAIN_ID=8453 \
X402_FACILITATOR_URL=https://api.cdp.coinbase.com/platform/v2/x402 \
pnpm dlx tsx scripts/x402-smoke.ts --expect=success
```

Expected: exit 0, a settlement tx hash printed; the tx appears on basescan.org as a USDC transfer agent-EOA → treasury, broadcast by the CDP relayer.

- [ ] **Step 5 (USER): One real paid thread on-device**

From the funded test wallet (`0x5028…97F9`), run a full paid thread in MiniPay. Verify all of:
- payment tx on **Celoscan** ($0.05, split 50/40/10),
- groq `step_settled` row in AgentTrace links to **Basescan** and the tx is real,
- other step rows still link Celo explorers,
- receipt screen per-call `tx↗` for groq goes to Basescan,
- Supabase `threads` row: `total_cost_usd` sane, tweets delivered,
- no Discord fallback alert fired (if one did, the run fell back — investigate before calling it done).

- [ ] **Step 6: Record the rollback levers + close out**

Rollback documentation lives in the spec §4/§5 and `docs/x402-mainnet-proof.md` (Task 5): `X402_SETTLE_MODE=legacy` + redeploy, or instant `redis set x402:paused 1` (degrades to legacy per Task 2). Confirm the Redis key path works once: set it, run a thread (expect legacy settle + Discord alert), then delete the key.

---

## Self-Review (done at write time)

- **Spec coverage:** §1 routing → Task 1; §2 fallback → Task 2; §3 event/UI → Tasks 3–4 (including `receiptText`/`PostShareScreen` audit — receipt plain-text confirmed link-free); §4 ops → Task 6; §5 testing → embedded per task; docs bullet in §4 → Task 5.
- **Type consistency:** `chainId?: number` is the field name across `PipelineEvent.step_settled`, `DraftResult`, `StepState`, `TraceLine`, `X402Call`; `getSettleChainId()` is the only source of the settle chain.
- **Placeholder scan:** `<user>` values in Task 6 step 3 are genuinely user-held secrets, listed explicitly; no TBDs elsewhere.
