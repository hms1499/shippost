# Generate Mode Registry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-written `if (mode === 0) … else …` branches with a mode *registry* so that adding a new generate mode means adding **one file + one registry line**, not editing 6 scattered switch sites.

**Architecture:** Each mode becomes a `ModeDef` descriptor object (`id`, `validateInput`, `run`, `preview`) living in `lib/pipeline/modes/`. A registry (`MODES` map + `getMode()`) is the single lookup point. The route (`/api/generate/stream`) and the free preview (`runPreview.ts`) stop branching and just call `getMode(mode).run(...)` / `.preview(...)`. The existing `runModeA`/`runModeB` pipeline functions are **reused unchanged** — this is a refactor, not a rewrite.

**Tech Stack:** Next.js 14 App Router (route handler + SSE), TypeScript, Vitest 4 (`pnpm test:lib`), pnpm.

---

## Why this is safe (read before starting)

This is a **pure refactor**: after every task the app must behave exactly as before. Your safety net is the existing test suite — two files already lock the behaviour we must not change:

- `app/api/generate/stream/route.test.ts` — money invariants of the paid path.
- `lib/pipeline/runPreview.test.ts` — preview behaviour + the "never settles" source guard.

**Golden rule:** run `pnpm test:lib` before you start (record it green), and after every task. If a task turns it red, fix that task before moving on. Never start a new task on a red suite.

## Invariants you MUST preserve (project constraints, not optional)

1. **`mode` id is an on-chain contract.** The numeric mode is emitted in `ThreadRequested` (`contracts/ShipPostPayment.sol:116`) and re-asserted by `verifyPayment` (`route.ts:113`). So a `ModeDef.id` **must equal** the on-chain `uint8`, and ids are **append-only**: never renumber `0` (educational) or `1` (hotTake). New modes get the next free integer.
2. **Settle gates delivery.** Every mode's `run()` must settle an x402 call *before* it emits the tweet content. We are only *moving* the existing `runModeA`/`runModeB` calls, not reordering anything inside them — keep it that way.
3. **Preview never spends.** Every mode's `preview()` must never settle, never touch `AgentWallet`, never write Supabase. A source-guard test enforces this (Task 7 extends it to the new files).

## File structure

| File | Responsibility | Phase |
|---|---|---|
| `lib/pipeline/modes/types.ts` | The `ModeDef` interface + shared input/output types | 1 |
| `lib/pipeline/modes/educational.ts` | Mode 0 descriptor — delegates to `runModeA` | 1 |
| `lib/pipeline/modes/hotTake.ts` | Mode 1 descriptor — delegates to `runModeB` | 1 |
| `lib/pipeline/modes/index.ts` | `MODES` map + `getMode()` lookup | 1 |
| `lib/pipeline/modes/index.test.ts` | Unit test for the registry | 1 |
| `app/api/generate/stream/route.ts` | **Modify** — use `getMode` for validation + dispatch | 1 |
| `lib/pipeline/runPreview.ts` | **Modify** — delegate to `getMode(...).preview()` | 2 |
| `lib/pipeline/runPreview.test.ts` | **Modify** — extend drain-safety guard to mode files | 2 |

**Phase 1 (Tasks 1–5)** refactors the paid path. **Phase 2 (Tasks 6–7)** folds the free preview in. You may ship Phase 1 alone and pause — the app is fully working between phases.

---

## Phase 1 — Registry for the paid path

### Task 1: Define the `ModeDef` interface and shared types

**Files:**
- Create: `lib/pipeline/modes/types.ts`

- [ ] **Step 1: Create the types file**

```ts
// lib/pipeline/modes/types.ts
import type { PipelineContext, PipelineEvent } from '@/lib/pipeline/types';
import type { Audience } from '@/lib/prompts/modeA';
import type { Angle } from '@/lib/prompts/modeB';

export type Emit = (e: PipelineEvent) => void;

// The mode-relevant subset of the request body. Structurally compatible with
// the route's StreamRequest, so the route passes its body straight through.
export interface ModeInputBody {
  mode?: number;
  topic?: string;
  audience?: Audience;
  eventDescription?: string;
  angle?: Angle;
}

// Every mode normalises its result to this shape so the route can persist and
// stream uniformly, no matter how many grounding steps the mode ran.
export interface UnifiedModeOutput {
  tweets: string[];
  totalCostUsd: string;
  searchSummary: string | null;
  marketSnippet: string | null;
}

export interface ModeDef {
  // MUST equal the uint8 emitted on-chain in ThreadRequested. Append-only —
  // never renumber an existing mode (see plan "Invariants").
  id: number;
  key: string;
  // Returns null when valid, else a 400 message. No paid work runs if non-null.
  validateInput(body: ModeInputBody): string | null;
  // Runs the paid pipeline. Settle MUST gate every content emit (we only move
  // the existing runModeA/runModeB calls here, never reorder their internals).
  run(ctx: PipelineContext, body: ModeInputBody, emit: Emit): Promise<UnifiedModeOutput>;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `lib/pipeline/modes/types.ts`. (`PipelineContext`, `PipelineEvent`, `Audience`, `Angle` all already exist in the imported files.)

- [ ] **Step 3: Commit**

```bash
git add lib/pipeline/modes/types.ts
git commit -m "feat(modes): add ModeDef interface and shared types"
```

---

### Task 2: Educational mode descriptor (mode 0)

**Files:**
- Create: `lib/pipeline/modes/educational.ts`

- [ ] **Step 1: Create the descriptor**

This moves the Mode-A validation from `route.ts:81-83` verbatim and wraps the existing `runModeA`. The `validateInput` message strings are copied exactly so existing tests keep passing (`route.test.ts:128` asserts `'topic required'`).

```ts
// lib/pipeline/modes/educational.ts
import { runModeA, MODE_A_TOTAL_COST_USD } from '@/lib/pipeline/runModeA';
import type { ModeDef } from './types';

const VALID_AUDIENCES = ['beginner', 'intermediate', 'advanced'] as const;

export const educationalMode: ModeDef = {
  id: 0,
  key: 'educational',
  validateInput(b) {
    if (!b.topic?.trim()) return 'topic required for Mode A';
    if (b.audience && !VALID_AUDIENCES.includes(b.audience)) return 'invalid audience';
    return null;
  },
  async run(ctx, _body, emit) {
    const { tweets } = await runModeA(ctx, emit);
    // Mode A is a single Groq settle, so its total is exactly the Groq cost.
    return { tweets, totalCostUsd: MODE_A_TOTAL_COST_USD, searchSummary: null, marketSnippet: null };
  },
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/pipeline/modes/educational.ts
git commit -m "feat(modes): add educational mode descriptor (mode 0)"
```

---

### Task 3: Hot-take mode descriptor (mode 1)

**Files:**
- Create: `lib/pipeline/modes/hotTake.ts`

- [ ] **Step 1: Create the descriptor**

Moves Mode-B validation from `route.ts:85-86` and the `runModeB` call shape from `route.ts:206-213`. The `angle ?? 'skeptical'` and `eventDescription ?? ''` defaults are copied exactly from the route.

```ts
// lib/pipeline/modes/hotTake.ts
import { runModeB } from '@/lib/pipeline/runModeB';
import type { Angle } from '@/lib/prompts/modeB';
import type { ModeDef } from './types';

const VALID_ANGLES: Angle[] = ['bullish', 'bearish', 'skeptical'];

export const hotTakeMode: ModeDef = {
  id: 1,
  key: 'hotTake',
  validateInput(b) {
    if (!b.eventDescription?.trim()) return 'eventDescription required for Mode B';
    if (b.angle && !VALID_ANGLES.includes(b.angle)) return 'invalid angle';
    return null;
  },
  async run(ctx, body, emit) {
    const out = await runModeB(
      { ...ctx, angle: body.angle ?? 'skeptical', eventDescription: body.eventDescription ?? '' },
      emit,
    );
    return {
      tweets: out.tweets,
      totalCostUsd: out.totalCostUsd,
      searchSummary: out.searchSummary,
      marketSnippet: out.marketSnippet,
    };
  },
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add lib/pipeline/modes/hotTake.ts
git commit -m "feat(modes): add hot-take mode descriptor (mode 1)"
```

---

### Task 4: The registry (`MODES` + `getMode`) with a unit test

**Files:**
- Create: `lib/pipeline/modes/index.ts`
- Test: `lib/pipeline/modes/index.test.ts`

- [ ] **Step 1: Write the failing test**

The mocks at the top stop importing the descriptors from pulling the real Groq/Serper pipeline into the test (we only test the mapping, not `run`).

```ts
// lib/pipeline/modes/index.test.ts
import { describe, it, expect, vi } from 'vitest';

// Keep the registry test pure: importing the descriptors must not drag in the
// real paid pipeline (groq-sdk, env, etc.). We only exercise the id→def map.
vi.mock('@/lib/pipeline/runModeA', () => ({ runModeA: vi.fn(), MODE_A_TOTAL_COST_USD: '0.050' }));
vi.mock('@/lib/pipeline/runModeB', () => ({ runModeB: vi.fn() }));

const { getMode, MODES } = await import('./index');

describe('mode registry', () => {
  it('maps id 0 to the educational mode', () => {
    expect(getMode(0)?.id).toBe(0);
    expect(getMode(0)?.key).toBe('educational');
  });

  it('maps id 1 to the hot-take mode', () => {
    expect(getMode(1)?.key).toBe('hotTake');
  });

  it('returns null for an unknown mode id', () => {
    expect(getMode(7)).toBeNull();
  });

  it('returns null for undefined/null', () => {
    expect(getMode(undefined)).toBeNull();
    expect(getMode(null)).toBeNull();
  });

  it('every registered mode key matches its map id', () => {
    for (const [id, mode] of Object.entries(MODES)) {
      expect(mode.id).toBe(Number(id));
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:lib -- lib/pipeline/modes/index.test.ts`
Expected: FAIL — cannot resolve `./index` (file does not exist yet).

- [ ] **Step 3: Create the registry**

```ts
// lib/pipeline/modes/index.ts
import type { ModeDef } from './types';
import { educationalMode } from './educational';
import { hotTakeMode } from './hotTake';

export type { ModeDef, ModeInputBody, UnifiedModeOutput, Emit } from './types';

export const MODES: Record<number, ModeDef> = {
  [educationalMode.id]: educationalMode,
  [hotTakeMode.id]: hotTakeMode,
};

export function getMode(id: number | undefined | null): ModeDef | null {
  if (id == null) return null;
  return MODES[id] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:lib -- lib/pipeline/modes/index.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/modes/index.ts lib/pipeline/modes/index.test.ts
git commit -m "feat(modes): add registry (MODES map + getMode) with tests"
```

---

### Task 5: Refactor the route to use the registry

This is the payoff for the paid path. The existing `route.test.ts` is your regression guard — it must stay green because `getMode` delegates to the same `runModeA`/`runModeB` the test already mocks.

**Files:**
- Modify: `app/api/generate/stream/route.ts`

- [ ] **Step 1: Confirm the suite is green before touching anything**

Run: `pnpm test:lib -- app/api/generate/stream/route.test.ts`
Expected: PASS (all). Record this as your baseline.

- [ ] **Step 2: Swap the imports**

Replace these two lines at the top of `route.ts` (lines 1-2):

```ts
import { runModeA, MODE_A_TOTAL_COST_USD } from '@/lib/pipeline/runModeA';
import { runModeB } from '@/lib/pipeline/runModeB';
```

with:

```ts
import { getMode } from '@/lib/pipeline/modes';
```

(Keep the `import type { Angle } from '@/lib/prompts/modeB';` line — `Angle` is still used in the `StreamRequest` interface.)

- [ ] **Step 3: Remove the now-unused validation constants**

Delete these two lines (currently `route.ts:27-28`) — they move into the descriptors and would otherwise fail lint as unused:

```ts
const VALID_AUDIENCES = ['beginner', 'intermediate', 'advanced'] as const;
const VALID_ANGLES: Angle[] = ['bullish', 'bearish', 'skeptical'];
```

- [ ] **Step 4: Replace the mode branch inside `validate()`**

Replace this block (currently `route.ts:79-88`):

```ts
  if (b.mode !== 0 && b.mode !== 1) return 'mode must be 0 or 1';

  if (b.mode === 0) {
    if (!b.topic?.trim()) return 'topic required for Mode A';
    if (b.audience && !VALID_AUDIENCES.includes(b.audience)) return 'invalid audience';
  } else {
    if (!b.eventDescription?.trim()) return 'eventDescription required for Mode B';
    if (b.angle && !VALID_ANGLES.includes(b.angle)) return 'invalid angle';
  }
  return null;
```

with:

```ts
  const mode = getMode(b.mode);
  if (!mode) return 'unknown mode';
  return mode.validateInput(b);
```

- [ ] **Step 5: Replace the dispatch branch**

Replace this block (currently `route.ts:200-221`):

```ts
        if (body.mode === 0) {
          const out = await withDeadline(runModeA(baseCtx, emit), PIPELINE_DEADLINE_MS, () => ac.abort());
          tweets = out.tweets;
          totalCostUsd = MODE_A_TOTAL_COST_USD;
        } else {
          const out = await withDeadline(
            runModeB(
              {
                ...baseCtx,
                angle: body.angle ?? 'skeptical',
                eventDescription: body.eventDescription ?? '',
              },
              emit,
            ),
            PIPELINE_DEADLINE_MS,
            () => ac.abort(),
          );
          tweets = out.tweets;
          totalCostUsd = out.totalCostUsd;
          searchSummary = out.searchSummary;
          marketSnippet = out.marketSnippet;
        }
```

with:

```ts
        const modeDef = getMode(body.mode);
        if (!modeDef) throw new Error('unknown mode'); // validated already; defensive
        const out = await withDeadline(
          modeDef.run(baseCtx, body, emit),
          PIPELINE_DEADLINE_MS,
          () => ac.abort(),
        );
        tweets = out.tweets;
        totalCostUsd = out.totalCostUsd;
        searchSummary = out.searchSummary;
        marketSnippet = out.marketSnippet;
```

(Leave the `let tweets`, `let totalCostUsd`, `let searchSummary`, `let marketSnippet` declarations at `route.ts:195-198` exactly as they are.)

- [ ] **Step 6: Run the route suite — must still be green**

Run: `pnpm test:lib -- app/api/generate/stream/route.test.ts`
Expected: PASS (all). Pay attention to:
- `returns 400 on an out-of-range mode` (mode 7 → `getMode` returns null → `'unknown mode'` → 400)
- `persists ... total_cost_usd` equals `MODE_A_TOTAL_COST_USD` (`'0.050'`)
- `runs runModeB and persists its summary/snippet/cost`
- the two deadline-abort tests (the `signal` is preserved because `baseCtx` is passed straight through)

If anything is red, re-check Steps 2–5 against the exact line blocks above before continuing.

- [ ] **Step 7: Lint + typecheck**

Run: `pnpm lint && npx tsc --noEmit`
Expected: no errors (in particular, no "unused variable" for the deleted constants or removed imports).

- [ ] **Step 8: Commit**

```bash
git add app/api/generate/stream/route.ts
git commit -m "refactor(generate): dispatch paid path through mode registry"
```

**Phase 1 done.** Adding a paid mode now needs: a new descriptor file + one line in `index.ts`. The free preview still branches — Phase 2 fixes that.

---

## Phase 2 — Fold the free preview into the registry

### Task 6: Add `preview()` to the interface and both descriptors

**Files:**
- Modify: `lib/pipeline/modes/types.ts`
- Modify: `lib/pipeline/modes/educational.ts`
- Modify: `lib/pipeline/modes/hotTake.ts`

- [ ] **Step 1: Extend the interface with `PreviewInput` + `preview()`**

In `lib/pipeline/modes/types.ts`, add this interface (place it above `ModeDef`):

```ts
// Free-preview input. Settle-free: produces a draft without paying anything.
export interface PreviewInput {
  mode: number;
  topic?: string;
  audience?: Audience;
  eventDescription?: string;
  angle?: Angle;
}
```

Then add this method to the `ModeDef` interface (after `run`):

```ts
  // Settle-free draft for the free preview. MUST never settle, spend from the
  // agent wallet, or persist a row (a source-guard test enforces this).
  preview(input: PreviewInput): Promise<{ tweets: string[] }>;
```

- [ ] **Step 2: Implement `preview` on the educational descriptor**

This is the Mode-0 branch of `runPreview.ts:27-36`, moved verbatim. Add these imports at the top of `lib/pipeline/modes/educational.ts`:

```ts
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeAPrompt } from '@/lib/prompts/modeA';
import { generateTweets } from '@/lib/pipeline/generateDraft';
```

Then add this method to `educationalMode` (after `run`):

```ts
  async preview(input) {
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildModeAPrompt({ topic: input.topic ?? '', audience: input.audience ?? 'beginner' }),
      },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.7, maxTokens: 1200 }) };
  },
```

- [ ] **Step 3: Implement `preview` on the hot-take descriptor**

This is the Mode-1 branch of `runPreview.ts:38-66`, moved verbatim (log prefixes renamed to `[hotTake.preview]`). Add these imports at the top of `lib/pipeline/modes/hotTake.ts`:

```ts
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeBPrompt, summarizeSerper, summarizeMarket } from '@/lib/prompts/modeB';
import { generateTweets } from '@/lib/pipeline/generateDraft';
import { fetchSerper } from '@/lib/pipeline/serperStep';
import { fetchCoinGecko } from '@/lib/pipeline/coingeckoStep';
```

Then add this method to `hotTakeMode` (after `run`):

```ts
  async preview(input) {
    // Grounding is soft: a failed Serper/CoinGecko still yields a draft.
    const event = input.eventDescription ?? '';
    let searchSummary: string | null = null;
    try {
      const s = await fetchSerper(event);
      searchSummary = summarizeSerper(s.organic, s.newsSnippet);
    } catch (e) {
      console.error('[hotTake.preview] serper failed, continuing:', e instanceof Error ? e.message : e);
    }
    let marketSnippet: string | null = null;
    try {
      marketSnippet = summarizeMarket(await fetchCoinGecko(event));
    } catch (e) {
      console.error('[hotTake.preview] coingecko failed, continuing:', e instanceof Error ? e.message : e);
    }
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: buildModeBPrompt({
          eventDescription: event,
          angle: input.angle ?? 'bullish',
          searchSummary,
          marketSnippet,
        }),
      },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.85, maxTokens: 1400 }) };
  },
```

- [ ] **Step 4: Typecheck + run the full suite (old `runPreview.ts` still in use, must stay green)**

Run: `npx tsc --noEmit && pnpm test:lib`
Expected: PASS. `runPreview.ts` is unchanged so its tests still pass; the new `preview` methods just need to compile.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/modes/types.ts lib/pipeline/modes/educational.ts lib/pipeline/modes/hotTake.ts
git commit -m "feat(modes): add settle-free preview() to each mode descriptor"
```

---

### Task 7: Make `runPreview` delegate to the registry + extend the drain-safety guard

**Files:**
- Modify: `lib/pipeline/runPreview.ts`
- Modify: `lib/pipeline/runPreview.test.ts`

- [ ] **Step 1: Update the test mocks so importing the descriptors stays isolated**

In `lib/pipeline/runPreview.test.ts`, the descriptors now import `runModeA`/`runModeB` (for their `run` methods). Add these two mocks so the preview test doesn't pull the real paid pipeline. Insert them right after the existing `vi.mock('./coingeckoStep', ...)` line (currently line 10):

```ts
vi.mock('@/lib/pipeline/runModeA', () => ({ runModeA: vi.fn(), MODE_A_TOTAL_COST_USD: '0.050' }));
vi.mock('@/lib/pipeline/runModeB', () => ({ runModeB: vi.fn() }));
```

- [ ] **Step 2: Extend the drain-safety guard to the mode files**

Replace the whole `describe('runPreview drain-safety invariant', ...)` block (currently `runPreview.test.ts:46-53`) with:

```ts
describe('preview drain-safety invariant', () => {
  it('no preview source references settle / AgentWallet / supabase', () => {
    const files = ['./runPreview.ts', './modes/educational.ts', './modes/hotTake.ts'];
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/settleX402Call/);
      expect(src, f).not.toMatch(/agentWallet|AgentWallet/);
      expect(src, f).not.toMatch(/supabase/i);
    }
  });
});
```

- [ ] **Step 3: Run the suite to verify it still passes with the OLD runPreview**

Run: `pnpm test:lib -- lib/pipeline/runPreview.test.ts`
Expected: PASS. (Guard now also scans the mode files; they contain no settle/AgentWallet/supabase literals, so it passes. The added mocks are harmless to the still-old `runPreview.ts`.)

- [ ] **Step 4: Replace `runPreview.ts` with a registry dispatcher**

Overwrite the entire file `lib/pipeline/runPreview.ts` with:

```ts
// Settle-free draft generation for the free preview. Delegates to the mode
// registry; each mode's preview() must NEVER settle an x402 call, spend from
// the agent wallet, or persist a thread row. A source-guard test enforces that
// across this file and every mode descriptor. Paying regenerates fresh via the
// unchanged paid pipeline.
import { getMode, type PreviewInput } from '@/lib/pipeline/modes';

export type { PreviewInput };

export async function runPreview(input: PreviewInput): Promise<{ tweets: string[] }> {
  const mode = getMode(input.mode);
  if (!mode) throw new Error(`unknown preview mode: ${input.mode}`);
  return mode.preview(input);
}
```

- [ ] **Step 5: Run the preview suite — must pass**

Run: `pnpm test:lib -- lib/pipeline/runPreview.test.ts`
Expected: PASS (all). The three behaviour tests now flow through `getMode(...).preview()`; the mocked `generateTweets`/`fetchSerper`/`fetchCoinGecko` are intercepted because the descriptors resolve to the same module files the test mocks.

- [ ] **Step 6: Confirm no other caller broke**

Run: `grep -rn "from '@/lib/pipeline/runPreview'" app lib`
Expected: any importer only uses `runPreview` and/or the `PreviewInput` type — both still exported, signature unchanged. If a caller imported a value other than these, reconcile it before committing.

- [ ] **Step 7: Full suite + lint + typecheck**

Run: `pnpm test:lib && pnpm lint && npx tsc --noEmit`
Expected: all PASS, no errors.

- [ ] **Step 8: Commit**

```bash
git add lib/pipeline/runPreview.ts lib/pipeline/runPreview.test.ts
git commit -m "refactor(preview): dispatch free preview through mode registry"
```

**Phase 2 done.** Both the paid path and the preview now route through one registry.

---

## Appendix — Recipe: adding mode #2 (the payoff)

Once both phases are merged, a new content-only mode (one that just needs a different prompt, e.g. a "Tutorial / How-to" mode reusing the Mode-A pipeline) costs you:

1. **Pick the next free id** — `2`. Confirm the contract accepts it (`uint8`, no range check beyond the whitelist; `verifyPayment` only asserts the emitted mode equals the body mode, so no contract change is needed for a new id). **Never reuse 0 or 1.**
2. **Create `lib/pipeline/modes/tutorial.ts`** — a `ModeDef` with `id: 2`, its own `validateInput`, a `run` that composes existing steps (reuse `runModeA`-style `runGroqStep`, or build a new `runModeC` if the pipeline genuinely differs), and a settle-free `preview`.
3. **Register it** — add `[tutorialMode.id]: tutorialMode` to `MODES` in `lib/pipeline/modes/index.ts`.
4. **Add its source files to the drain-safety guard** — append `'./modes/tutorial.ts'` to the `files` array in `runPreview.test.ts`.
5. **Write a descriptor unit test** mirroring `index.test.ts`, and let the existing route/preview suites cover the wiring.

No edits to `route.ts` validation or dispatch. No edits to `runPreview.ts`. That is the whole point of this refactor.

**Cost watch:** a mode that fires more paid x402 steps (like Mode B's up-to-3) eats more of the flat $0.05 the user pays. Before shipping an expensive mode, sanity-check its `totalCostUsd` against the AgentWallet split (50% of $0.05 = $0.025 to the agent wallet) so a single run can't go underwater. The `$10/token/day` cap in `executeX402Call` is a global backstop, not a per-run margin guarantee.

---

## Self-review notes (done while writing)

- **Spec coverage:** the two pain points named in the discussion — `route.ts` dispatch+validation and `runPreview.ts` — are both folded into the registry (Tasks 5 and 7). The on-chain append-only id constraint and settle-gates-delivery constraint are called out and preserved.
- **Type consistency:** `ModeDef`, `MODES`, `getMode`, `UnifiedModeOutput`, `ModeInputBody`, `PreviewInput`, `educationalMode`, `hotTakeMode`, `Emit` are spelled identically across every task.
- **Regression safety:** every existing assertion in `route.test.ts` and `runPreview.test.ts` was checked against the refactor (out-of-range mode → 400, `MODE_A_TOTAL_COST_USD` persistence, Mode-B summary/snippet, signal preservation, soft-fail grounding, drain-safety). Mocks were added where the new import graph would otherwise pull the real pipeline into a unit test.
