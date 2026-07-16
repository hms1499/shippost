# News Breakdown Mode (id 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a sixth paid generation mode — a neutral 4-beat breakdown of one specific news item (what happened → why it matters → who's affected → what to watch).

**Architecture:** New `ModeDef` (id 5, key `newsReaction`) that reuses the vetted `runModeB` settle/delivery orchestration via a `buildPrompt` override — the exact pattern `comparison` (id 4) shipped with. Input (URL-or-text + OG grounding via `composeEvent`) reuses the Hot Take infrastructure. No contract change (`payForThread` takes an unconstrained `uint8 mode`).

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest 4, Supabase (service-role), wagmi/viem, Tailwind + Radix.

**Spec:** `docs/superpowers/specs/2026-07-16-news-breakdown-mode-design.md`

## Global Constraints

- **Mode ids are append-only on-chain values.** New mode id is exactly `5`; never renumber existing ids. Display order on the picker is decoupled from id.
- **Settle gates delivery.** Only reuse `runModeB`; never reorder its internals. `preview()` must never settle, spend from AgentWallet, or persist (source-guard test enforces this).
- **The neutrality ban list is mode-local.** Words like "bullish" go in the News Breakdown prompt only — never into the global `lib/bannedPhrases.ts` (they are the whole point of Hot Take).
- **Copy values (verbatim from spec):** label `News Breakdown`, picker blurb `A news just dropped — what happened, why it matters, what to watch. No take, just clarity.`, cost `$0.003`, badge `grounded · fact-checked · live data`, icon `Newspaper` (lucide), numeral `VI`, display position II (right after Hot Take).
- **Serper recency for this mode:** `{ recency: 'qdr:w' }` (past week) — both paid path and preview.
- Commit each task directly to `main` (trunk-based, no branches). End every commit message with the trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Run `npx tsc --noEmit` before pushing — `pnpm test:lib`/`pnpm build` skip `*.test.ts` typechecking.
- `pnpm` for everything. Tests: `pnpm test:lib` (or `npx vitest run <file>` for one file).

---

### Task 1: Prompt builder

**Files:**
- Create: `lib/prompts/newsReaction.ts`
- Test: `lib/prompts/newsReaction.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces: `buildNewsBreakdownPrompt(input: { event: string; searchSummary: string | null; marketSnippet: string | null }): string` — Task 2 imports it.

- [ ] **Step 1: Write the failing test**

```ts
// lib/prompts/newsReaction.test.ts
import { describe, it, expect } from 'vitest';
import { buildNewsBreakdownPrompt } from './newsReaction';

describe('buildNewsBreakdownPrompt', () => {
  const base = {
    event: 'SEC approved spot ETH ETFs on May 23',
    searchSummary: null,
    marketSnippet: null,
  };

  it('contains the four beats and the news line', () => {
    const p = buildNewsBreakdownPrompt(base);
    expect(p).toContain('what just happened');
    expect(p).toContain('why it matters');
    expect(p).toContain('who is affected');
    expect(p).toContain('what to watch');
    expect(p).toContain('SEC approved spot ETH ETFs');
  });

  it('carries the neutrality constraints', () => {
    const p = buildNewsBreakdownPrompt(base);
    expect(p).toContain('Never pick a side');
    expect(p).toContain('No investment recommendation');
    expect(p).toContain('likely');
  });

  it('marks missing search context instead of dropping the block', () => {
    expect(buildNewsBreakdownPrompt(base)).toContain('none returned');
  });

  it('includes search and market blocks when provided', () => {
    const p = buildNewsBreakdownPrompt({ event: 'e', searchSummary: 'S1', marketSnippet: 'M1' });
    expect(p).toContain('S1');
    expect(p).toContain('Market data:\nM1');
  });

  it('omits the market block when snippet is null', () => {
    expect(buildNewsBreakdownPrompt(base)).not.toContain('Market data:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/prompts/newsReaction.test.ts`
Expected: FAIL — cannot resolve `./newsReaction`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/prompts/newsReaction.ts
// Prompt for News Breakdown (mode 5): a NEUTRAL explainer of one specific news
// item. Unlike Mode B there is no angle — the thread never picks a side. The
// neutrality ban list below is mode-local on purpose: words like "bullish" are
// the whole point of Hot Take, so they must never enter lib/bannedPhrases.ts.

interface NewsBreakdownInput {
  event: string;
  searchSummary: string | null;
  marketSnippet: string | null;
}

const STRUCTURE = `Structure (neutral breakdown, four beats in order):
- T1 — what just happened: the single hardest fact of the news (who did what, number, date). Cite the source host in parentheses when one appears in the news line. No question hooks, no "in this thread".
- T2 onward — why it matters: the mechanism or context that makes this consequential. Hard facts only.
- next — who is affected + numbers: named projects, chains, holder groups; cite market data when provided.
- T(n) — what to watch next: 1–2 concrete, observable follow-ups (a date, a vote, a threshold, an unlock). Not advice, not a verdict.

Neutrality rules (hard requirements):
- Never pick a side. Banned words and framings: bullish, bearish, moon, dump, pump, send it, "good/bad for price", buy, sell, long, short, accumulate.
- No investment recommendation of any kind.
- Separate fact from inference: facts come only from the news line, search context, or market data. Any inference must be marked "likely" or "could" and follow from a stated fact.
- Stay on this single news item. Do not drift into adjacent stories.`;

const LENGTH_GUIDANCE = `Length: 5–8 tweets. Never fewer than 4, never more than 9. Stop when the "what to watch" beat is delivered; do not pad.`;

const FEW_SHOT_EXAMPLE = `Reference for voice and shape (different news — match the structure, do NOT copy content):

Sample news: Circle launched native USDC on Celo on April 30, 2024, replacing bridged USDC.e (source: circle.com)
Sample search context:
- Circle announced native USDC issuance on Celo on April 30, 2024.
- Bridged USDC.e on Celo will migrate to native USDC via Portal.
- Celo fee abstraction lets users pay gas in stablecoins.
Sample market data: (none)

<example_thread>
1/ Circle launched native USDC on Celo on April 30, 2024 (circle.com). Until now, USDC on Celo was a bridged asset, USDC.e.

2/ Native issuance means Circle mints and redeems directly on Celo — no bridge in the redemption path, which is where bridged stablecoins carry their extra trust assumptions.

3/ Holders of bridged USDC.e are affected first: Portal is coordinating a migration to the native token. Apps quoting USDC.e liquidity will need to re-point pools and price feeds.

4/ Celo's fee abstraction already lets users pay gas in stablecoins, so native USDC slots directly into the fee path wallets like MiniPay use.

5/ What to watch: the migration deadline for USDC.e, and whether native USDC liquidity on Celo DEXes overtakes the bridged pools in the weeks after.
</example_thread>`;

export function buildNewsBreakdownPrompt(input: NewsBreakdownInput): string {
  const blocks = [
    FEW_SHOT_EXAMPLE,
    `Now write a neutral breakdown thread on this news:`,
    `News: ${input.event.trim()}`,
  ];

  if (input.searchSummary) {
    blocks.push(
      `Search context (ground truth — facts you cite must come from here):\n${input.searchSummary}`,
    );
  } else {
    blocks.push(`Search context: (none returned — keep claims general; do not invent specifics)`);
  }

  if (input.marketSnippet) {
    blocks.push(`Market data:\n${input.marketSnippet}`);
  }

  blocks.push(LENGTH_GUIDANCE);
  blocks.push(STRUCTURE);
  blocks.push('Output only the numbered tweets separated by blank lines. Nothing else.');

  return blocks.join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/prompts/newsReaction.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/prompts/newsReaction.ts lib/prompts/newsReaction.test.ts
git commit -m "feat(prompts): News Breakdown prompt — neutral 4-beat news explainer"
```

---

### Task 2: Mode descriptor + registry

**Files:**
- Create: `lib/pipeline/modes/newsReaction.ts`
- Test: `lib/pipeline/modes/newsReaction.test.ts`
- Modify: `lib/pipeline/modes/index.ts` (register id 5)
- Modify: `lib/pipeline/modes/index.test.ts` (registry assertion)

**Interfaces:**
- Consumes: `buildNewsBreakdownPrompt` (Task 1), `runModeB`, `composeEvent`, `summarizeSerper`/`summarizeMarket`, `fetchSerper`, `fetchCoinGecko`, `generateTweets`, `SYSTEM_PROMPT` — all existing.
- Produces: `newsReactionMode: ModeDef` with `id: 5`, `key: 'newsReaction'`; registered in `MODES` so `getMode(5)` resolves (both API routes pick it up automatically — they dispatch via the registry).

- [ ] **Step 1: Write the failing test**

```ts
// lib/pipeline/modes/newsReaction.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runModeB = vi.fn(async (_ctx: unknown, _emit: unknown) => ({
  tweets: ['1/ x'],
  totalCostUsd: '0.003',
  searchSummary: null,
  marketSnippet: null,
}));
vi.mock('@/lib/pipeline/runModeB', () => ({ runModeB }));
vi.mock('@/lib/pipeline/serperStep', () => ({
  fetchSerper: vi.fn(async () => ({ organic: [], newsSnippet: null })),
}));
vi.mock('@/lib/pipeline/coingeckoStep', () => ({
  fetchCoinGecko: vi.fn(async () => ({ symbol: null, priceUsd: null })),
}));
vi.mock('@/lib/pipeline/generateDraft', () => ({
  generateTweets: vi.fn(async () => ['1/ draft']),
}));

const { newsReactionMode } = await import('./newsReaction');

const baseCtx = {
  chainId: 42220,
  threadId: 1n,
  topic: 'x',
  audience: 'beginner' as const,
  agentWallet: '0x0000000000000000000000000000000000000000' as const,
};

describe('newsReactionMode.validateInput', () => {
  it('requires eventDescription', () => {
    expect(newsReactionMode.validateInput({})).not.toBeNull();
    expect(newsReactionMode.validateInput({ eventDescription: '  ' })).not.toBeNull();
  });
  it('accepts eventDescription and ignores a stray angle', () => {
    expect(
      newsReactionMode.validateInput({ eventDescription: 'SEC approves ETH ETFs', angle: 'bullish' }),
    ).toBeNull();
  });
});

describe('newsReactionMode.run', () => {
  beforeEach(() => runModeB.mockClear());

  it('grounds in eventContext, passes qdr:w recency and the neutral prompt', async () => {
    await newsReactionMode.run(
      { ...baseCtx },
      {
        eventDescription: 'https://x.co/a',
        eventContext: { title: 'BTC ETF record inflows', description: 'daily record', host: 'x.co' },
      },
      () => {},
    );
    expect(runModeB).toHaveBeenCalledTimes(1);
    const overrides = runModeB.mock.calls[0][0] as any;
    expect(overrides.serperQuery).toBe('BTC ETF record inflows');
    expect(overrides.serperOpts).toEqual({ recency: 'qdr:w' });
    const prompt = overrides.buildPrompt({ searchSummary: null, marketSnippet: null });
    expect(prompt).toContain('Never pick a side');
    expect(prompt).toContain('BTC ETF record inflows');
  });

  it('falls back to raw text when there is no eventContext', async () => {
    await newsReactionMode.run({ ...baseCtx }, { eventDescription: 'Celo upgrades to L2' }, () => {});
    const overrides = runModeB.mock.calls[0][0] as any;
    expect(overrides.serperQuery).toBe('Celo upgrades to L2');
  });
});

describe('newsReactionMode.preview', () => {
  it('drafts via generateTweets and never touches runModeB', async () => {
    const out = await newsReactionMode.preview({ mode: 5, eventDescription: 'Celo upgrades to L2' });
    expect(out.tweets).toEqual(['1/ draft']);
    expect(runModeB).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pipeline/modes/newsReaction.test.ts`
Expected: FAIL — cannot resolve `./newsReaction`.

- [ ] **Step 3: Write the implementation**

```ts
// lib/pipeline/modes/newsReaction.ts
import { runModeB } from '@/lib/pipeline/runModeB';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { summarizeSerper, summarizeMarket } from '@/lib/prompts/modeB';
import { buildNewsBreakdownPrompt } from '@/lib/prompts/newsReaction';
import { generateTweets } from '@/lib/pipeline/generateDraft';
import { fetchSerper } from '@/lib/pipeline/serperStep';
import { fetchCoinGecko } from '@/lib/pipeline/coingeckoStep';
import { composeEvent } from '@/lib/eventContext';
import type { ModeDef } from './types';

export const newsReactionMode: ModeDef = {
  id: 5,
  key: 'newsReaction',
  validateInput(b) {
    // A stray `angle` is ignored, not rejected: hostile body, harmless field.
    if (!b.eventDescription?.trim()) return 'eventDescription required for News Breakdown';
    return null;
  },
  async run(ctx, body, emit) {
    // Ground in the pasted URL's OG metadata when present (same contract as
    // Hot Take): the LLM sees headline+summary, Serper searches the headline.
    const { event, query } = composeEvent(body.eventDescription ?? '', body.eventContext);
    const out = await runModeB(
      {
        ...ctx,
        angle: 'skeptical', // required by type; buildPrompt fully overrides it
        eventDescription: event,
        serperQuery: query,
        // "News" older than a week isn't news; qdr:d would miss items indexed
        // just over 24h ago (overnight in VN time).
        serperOpts: { recency: 'qdr:w' },
        buildPrompt: ({ searchSummary, marketSnippet }) =>
          buildNewsBreakdownPrompt({ event, searchSummary, marketSnippet }),
      },
      emit,
    );
    return {
      tweets: out.tweets,
      totalCostUsd: out.totalCostUsd,
      searchSummary: out.searchSummary,
      marketSnippet: out.marketSnippet,
    };
  },
  async preview(input) {
    // Grounding is soft: a failed Serper/CoinGecko still yields a draft. Mirror
    // the paid path so the free preview reflects what paying will produce.
    const { event, query } = composeEvent(input.eventDescription ?? '', input.eventContext);
    let searchSummary: string | null = null;
    try {
      const s = await fetchSerper(query, { recency: 'qdr:w' });
      searchSummary = summarizeSerper(s.organic, s.newsSnippet);
    } catch (e) {
      console.error('[newsReaction.preview] serper failed, continuing:', e instanceof Error ? e.message : e);
    }
    let marketSnippet: string | null = null;
    try {
      marketSnippet = summarizeMarket(await fetchCoinGecko(event));
    } catch (e) {
      console.error('[newsReaction.preview] coingecko failed, continuing:', e instanceof Error ? e.message : e);
    }
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: buildNewsBreakdownPrompt({ event, searchSummary, marketSnippet }) },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.85, maxTokens: 1400 }) };
  },
};
```

- [ ] **Step 4: Register in the registry**

In `lib/pipeline/modes/index.ts` add the import and map entry:

```ts
import { newsReactionMode } from './newsReaction';
```

```ts
export const MODES: Record<number, ModeDef> = {
  [educationalMode.id]: educationalMode,
  [hotTakeMode.id]: hotTakeMode,
  [tokenAnalysisMode.id]: tokenAnalysisMode,
  [dailyRecapMode.id]: dailyRecapMode,
  [comparisonMode.id]: comparisonMode,
  [newsReactionMode.id]: newsReactionMode,
};
```

In `lib/pipeline/modes/index.test.ts` add inside the `mode registry` describe (the existing `getMode(7)` unknown-id test stays valid):

```ts
  it('maps id 5 to the news-breakdown mode', () => {
    expect(getMode(5)?.id).toBe(5);
    expect(getMode(5)?.key).toBe('newsReaction');
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/pipeline/modes/`
Expected: PASS — including the source-guard test that asserts previews never settle (`newsReaction.preview` only calls `fetchSerper`/`fetchCoinGecko`/`generateTweets`, so it complies). If a source-guard test fails, STOP and re-read its assertion — do not weaken the guard.

- [ ] **Step 6: Commit**

```bash
git add lib/pipeline/modes/newsReaction.ts lib/pipeline/modes/newsReaction.test.ts lib/pipeline/modes/index.ts lib/pipeline/modes/index.test.ts
git commit -m "feat(pipeline): News Breakdown mode (id 5) — runModeB with neutral prompt"
```

---

### Task 3: Preview route accepts mode 5

**Files:**
- Modify: `app/api/preview/route.ts:31-86`
- Test: `app/api/preview/route.test.ts`

**Interfaces:**
- Consumes: `getMode(5)` registered in Task 2 (`runPreview` dispatches via the registry — no change there).
- Produces: `POST /api/preview` accepts `{ mode: 5, walletAddress, eventDescription, eventContext? }`.

Note: `/api/generate/stream` needs **no change** — it validates and dispatches purely via `getMode(body.mode)`.

- [ ] **Step 1: Update the failing tests**

In `app/api/preview/route.test.ts`, change the existing out-of-range test from mode 5 to mode 6:

```ts
  it('rejects an out-of-range mode', async () => {
    const res = await POST(req({ mode: 6, walletAddress: '0xabc' }));
    expect(res.status).toBe(400);
  });
```

Then add at the end of the `describe('POST /api/preview', ...)` block:

```ts
  it('accepts mode 5 (News Breakdown) and forwards eventContext', async () => {
    runPreview.mockResolvedValue({ tweets: ['1/ hook', '2/ body'] });
    const eventContext = { title: 'BTC ETF record', description: 'inflows', host: 'x.co', kind: 'news' };
    const res = await POST(
      req({ mode: 5, walletAddress: '0xabc', eventDescription: 'https://x.co/a', eventContext }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ firstTweet: '1/ hook', totalTweets: 2 });
    expect(runPreview).toHaveBeenCalledWith({
      mode: 5,
      eventDescription: 'https://x.co/a',
      eventContext,
    });
  });

  it('rejects mode 5 without an eventDescription', async () => {
    const res = await POST(req({ mode: 5, walletAddress: '0xabc' }));
    expect(res.status).toBe(400);
    expect(runPreview).not.toHaveBeenCalled();
  });

  it('rejects a guest (no wallet) for mode 5', async () => {
    const res = await POST(req({ mode: 5, eventDescription: 'Celo upgrades to L2' }));
    expect(res.status).toBe(400);
    expect(runPreview).not.toHaveBeenCalled();
    expect(checkPreviewGuestAllowed).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run app/api/preview/route.test.ts`
Expected: FAIL — the mode-5 acceptance test gets 400 (`mode must be 0, 1, 2, 3, or 4`).

- [ ] **Step 3: Implement the route change**

In `app/api/preview/route.ts`, widen the gate (lines 31-39):

```ts
  if (
    body.mode !== 0 &&
    body.mode !== 1 &&
    body.mode !== 2 &&
    body.mode !== 3 &&
    body.mode !== 4 &&
    body.mode !== 5
  ) {
    return NextResponse.json({ error: 'mode must be 0, 1, 2, 3, 4, or 5' }, { status: 400 });
  }
```

Add a mode-5 branch after the `body.mode === 4` branch (before the final `else` that handles mode 1):

```ts
  } else if (body.mode === 5) {
    // News Breakdown — one news item, no angle. Same input contract as mode 1
    // minus the angle.
    if (typeof body.eventDescription !== 'string' || !body.eventDescription.trim()) {
      return NextResponse.json({ error: 'eventDescription required' }, { status: 400 });
    }
    input = { mode: 5, eventDescription: body.eventDescription, eventContext: body.eventContext ?? null };
  } else {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run app/api/preview/route.test.ts`
Expected: PASS (all, including the flipped out-of-range test).

- [ ] **Step 5: Commit**

```bash
git add app/api/preview/route.ts app/api/preview/route.test.ts
git commit -m "feat(api): preview route accepts News Breakdown (mode 5)"
```

---

### Task 4: Funnel gates + DB migration

**Files:**
- Modify: `lib/funnelTypes.ts:25-36`
- Modify: `lib/funnel.ts:38`
- Modify: `lib/funnelReport.ts:34-57`
- Create: `supabase/migrations/0010_funnel_mode5.sql`
- Test: `lib/funnelTypes.test.ts`, `lib/funnelReport.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `isValidMode(5) === true`; `FunnelEventInput.mode` union includes `5`; `computeFunnel(...).byMode[5]`; DB CHECK admits mode 5. Task 6 (HomeClient) relies on `track(..., { mode: 5 })` passing the `lib/funnel.ts` gate.

- [ ] **Step 1: Update the failing tests**

In `lib/funnelTypes.test.ts`, the existing assertion `expect(isValidMode(5)).toBe(false)` must flip. Replace that test with:

```ts
  it('isValidMode accepts 0–5 and null/undefined, rejects the rest', () => {
    expect(isValidMode(0)).toBe(true);
    expect(isValidMode(2)).toBe(true);
    expect(isValidMode(3)).toBe(true);
    expect(isValidMode(4)).toBe(true);
    expect(isValidMode(5)).toBe(true);
    expect(isValidMode(null)).toBe(true);
    expect(isValidMode(undefined)).toBe(true);
    expect(isValidMode(6)).toBe(false);
    expect(isValidMode('1')).toBe(false);
```
(keep the remaining assertions in that test unchanged).

In `lib/funnelReport.test.ts`, append this `describe` at the end of the file (it uses the already-imported `computeFunnel`; if the import list differs, reuse whatever the file imports):

```ts
describe('byMode mode 5 (News Breakdown)', () => {
  it('buckets mode-5 rows into byMode[5]', () => {
    const rows = [
      { session_id: 'a', stage: 'mode_select', mode: 5 },
      { session_id: 'b', stage: 'mode_select', mode: 1 },
    ];
    const r = computeFunnel(rows);
    expect(r.byMode[5].mode_select).toBe(1);
    expect(r.byMode[1].mode_select).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/funnelTypes.test.ts lib/funnelReport.test.ts`
Expected: FAIL — `isValidMode(5)` is `false`; `byMode[5]` is not typed/produced.

- [ ] **Step 3: Implement**

`lib/funnelTypes.ts` — widen guard and wire shape:

```ts
export function isValidMode(v: unknown): v is 0 | 1 | 2 | 3 | 4 | 5 | null | undefined {
  return (
    v === null || v === undefined || v === 0 || v === 1 || v === 2 || v === 3 || v === 4 || v === 5
  );
}

// The wire shape the client sends and the ingest route validates.
export interface FunnelEventInput {
  session_id: string;
  stage: FunnelStage;
  mode?: 0 | 1 | 2 | 3 | 4 | 5 | null;
  chain_id?: number | null;
  wallet_address?: string | null;
}
```

`lib/funnel.ts` line 38 — add mode 5 to the client emitter gate:

```ts
  if (opts.mode === 0 || opts.mode === 1 || opts.mode === 2 || opts.mode === 3 || opts.mode === 4 || opts.mode === 5) payload.mode = opts.mode;
```

`lib/funnelReport.ts` — widen `byMode` (comment on line 34, type on 35, map on 51-57):

```ts
  // byMode[0|1|2|3|4|5] = per-stage distinct sessions for rows with that mode.
  byMode: Record<0 | 1 | 2 | 3 | 4 | 5, StageCounts>;
```

```ts
  const byMode = {
    0: distinctPerStage(rows.filter((r) => r.mode === 0)),
    1: distinctPerStage(rows.filter((r) => r.mode === 1)),
    2: distinctPerStage(rows.filter((r) => r.mode === 2)),
    3: distinctPerStage(rows.filter((r) => r.mode === 3)),
    4: distinctPerStage(rows.filter((r) => r.mode === 4)),
    5: distinctPerStage(rows.filter((r) => r.mode === 5)),
  } as Record<0 | 1 | 2 | 3 | 4 | 5, StageCounts>;
```

Create `supabase/migrations/0010_funnel_mode5.sql`:

```sql
-- News Breakdown (mode 5) emits funnel events the current CHECK rejects: the
-- mode constraint stops at (0,1,2,3,4) (migration 0009, itself the mode-4
-- fix). Widen to include 5. threads.mode has no CHECK, so only funnel_events
-- is affected.
alter table public.funnel_events
  drop constraint if exists funnel_events_mode_check;
alter table public.funnel_events
  add constraint funnel_events_mode_check check (mode in (0,1,2,3,4,5));
```

(The migration is applied to prod in Task 8 — it is deploy-safe to apply before the code ships because it only widens the constraint.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/funnelTypes.test.ts lib/funnelReport.test.ts lib/funnel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/funnelTypes.ts lib/funnel.ts lib/funnelReport.ts lib/funnelTypes.test.ts lib/funnelReport.test.ts supabase/migrations/0010_funnel_mode5.sql
git commit -m "feat(funnel): admit mode 5 (News Breakdown) — types, emitter gate, report, DB CHECK"
```

---

### Task 5: threadLabel + screens

**Files:**
- Modify: `lib/threadLabel.ts:8-13`
- Modify: `lib/screens.ts`
- Test: `lib/threadLabel.test.ts`, `lib/screens.test.ts`

**Interfaces:**
- Produces: `Screen` union includes `'news-breakdown'` (Task 6/7 depend on it); `threadLabel({ mode: 5, topic: null })` falls back to `'News Breakdown'`.

- [ ] **Step 1: Write the failing tests**

Append to the top-level describe in `lib/threadLabel.test.ts`:

```ts
  it('falls back to "News Breakdown" for a topicless mode-5 row', () => {
    expect(threadLabel({ mode: 5, topic: null })).toBe('News Breakdown');
  });

  it('prefers the headline topic for a mode-5 row', () => {
    expect(threadLabel({ mode: 5, topic: 'SEC approves spot ETH ETFs' })).toBe(
      'SEC approves spot ETH ETFs',
    );
  });
```

Append to the top-level describe in `lib/screens.test.ts`:

```ts
  it('news-breakdown is an input screen', () => {
    expect(isInputScreen('news-breakdown')).toBe(true);
    expect(isOutputScreen('news-breakdown')).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/threadLabel.test.ts lib/screens.test.ts`
Expected: FAIL — mode 5 yields `'Untitled thread'`; `'news-breakdown'` is not a valid `Screen` (type error at test compile).

- [ ] **Step 3: Implement**

`lib/threadLabel.ts` — extend the fallback map:

```ts
const MODE_FALLBACK: Record<number, string> = {
  1: 'Hot Take',
  2: 'Token Analysis',
  3: 'Daily Recap',
  4: 'Chain Comparison',
  5: 'News Breakdown',
};
```

`lib/screens.ts` — add the screen to both the union and the input list:

```ts
export type Screen =
  | 'mode'
  | 'educational'
  | 'hot-take'
  | 'news-breakdown'
  | 'token-analysis'
  | 'daily-recap'
  | 'comparison'
  | 'preview-locked'
  | 'generating'
  | 'preview'
  | 'post-share';

const INPUT_SCREENS: readonly Screen[] = ['mode', 'educational', 'hot-take', 'news-breakdown', 'token-analysis', 'daily-recap', 'comparison'];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/threadLabel.test.ts lib/screens.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/threadLabel.ts lib/screens.ts lib/threadLabel.test.ts lib/screens.test.ts
git commit -m "feat(ui-plumbing): news-breakdown screen + mode-5 thread label"
```

---

### Task 6: NewsBreakdownInput component

**Files:**
- Create: `components/NewsBreakdownInput.tsx`

**Interfaces:**
- Consumes: `TokenSelector`, `UrlPreviewCard`, `useBalances`, `computeTokenAmount`, `parseUrl`, `EventContext` — all existing (same set as `HotTakeInput`).
- Produces: `NewsBreakdownSubmitPayload { eventUrl: string | null; eventDescription: string; token: TokenBalance; eventContext: EventContext | null }` and `NewsBreakdownInput` component with props `{ onSubmit, onBack?, disabled?, submitting? }` — Task 7 wires both.

No unit test: components have no Vitest coverage convention in this repo; the runtime `/verify` pass in Task 8 covers it.

- [ ] **Step 1: Write the component**

Deliberate copy of `components/HotTakeInput.tsx` with the angle row removed (per spec, a `variant` prop would muddy `HotTakeInput` more than a focused copy). Full content:

```tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Newspaper, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { TokenSelector } from './TokenSelector';
import { UrlPreviewCard, type UrlPreview } from './UrlPreviewCard';
import { useBalances, type TokenBalance } from '@/lib/useBalances';
import { computeTokenAmount } from '@/lib/tokens';
import { parseUrl } from '@/lib/urlParser';
import type { EventContext } from '@/lib/eventContext';
import { formatUnits } from 'viem';

export interface NewsBreakdownSubmitPayload {
  eventUrl: string | null;
  eventDescription: string;
  token: TokenBalance;
  // OG metadata of the pasted URL (when resolved), so the agent reads the
  // article instead of the raw URL string. Null when no URL / preview failed.
  eventContext: EventContext | null;
}

interface Props {
  onSubmit: (p: NewsBreakdownSubmitPayload) => void;
  onBack?: () => void;
  disabled?: boolean;
  /** free-preview draft in flight — disables the form and swaps the CTA label */
  submitting?: boolean;
}

const MIN_LEN = 10;
const MAX_LEN = 600;

export function NewsBreakdownInput({ onSubmit, onBack, disabled, submitting }: Props) {
  const { balances, isLoading } = useBalances();
  const [input, setInput] = useState('');

  const parsed = useMemo(() => parseUrl(input), [input]);
  const isUrl = parsed !== null;

  // Capture the OG metadata UrlPreviewCard fetches for display, so we can
  // forward it to generation (the agent reads the article, not the URL string).
  const [urlPreview, setUrlPreview] = useState<UrlPreview | null>(null);
  const onPreviewResolved = useCallback((p: UrlPreview) => setUrlPreview(p), []);

  const defaultToken = useMemo(() => {
    if (!balances.length) return null;
    return [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
  }, [balances]);

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const effectiveToken = selectedToken ?? defaultToken;
  const insufficient =
    effectiveToken !== null &&
    effectiveToken.balance < computeTokenAmount(effectiveToken);

  const trimmedLen = input.trim().length;
  const canSubmit =
    trimmedLen >= MIN_LEN &&
    trimmedLen <= MAX_LEN &&
    effectiveToken !== null &&
    !insufficient &&
    !disabled &&
    !submitting;

  const amountStr = effectiveToken
    ? Number(formatUnits(computeTokenAmount(effectiveToken), effectiveToken.decimals)).toFixed(2)
    : '';

  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={disabled || submitting}
          className="self-start flex items-center gap-1.5 heading-sub text-[10px] no-underline hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowLeft size={12} aria-hidden />
          Modes
        </button>
      )}

      <TerminalPanel variant="plain" className="w-full">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <Newspaper size={18} className="text-primary shrink-0" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <p className="heading-sub text-[10px]">News breakdown</p>
              <h2 className="font-mono font-bold text-xl leading-tight tracking-tight">
                Set the news
              </h2>
            </div>
          </div>
          <p className="text-sm font-sans text-muted-foreground leading-snug">
            Paste a link to the news, or type the headline.
          </p>

          <RuleDivider />

          {/* News */}
          <div className="flex flex-col gap-2">
            <label htmlFor="news" className="heading-sub text-[10px]">News</label>
            <div className="flex items-start rounded-md border border-input bg-card px-3 py-2 font-mono text-sm">
              <span className="text-primary select-none">&gt;&nbsp;</span>
              <Textarea
                id="news"
                rows={3}
                placeholder="Paste an article or tweet URL, or type the headline in one sentence."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={disabled}
                className="flex-1 h-auto min-h-0 border-0 bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            <p
              className={`text-xs font-mono ${
                trimmedLen > MAX_LEN ? 'text-destructive' : 'text-muted-foreground'
              }`}
            >
              {trimmedLen}/{MAX_LEN}
            </p>
            {isUrl && parsed && (
              <UrlPreviewCard url={parsed.url} onResolved={onPreviewResolved} />
            )}
          </div>

          {/* Token */}
          <div className="flex flex-col gap-2">
            <p className="heading-sub text-[10px]">Token</p>
            {isLoading ? (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-muted-foreground" aria-hidden />
                Loading balances…
              </p>
            ) : (
              <TokenSelector balances={balances} selected={effectiveToken} onSelect={setSelectedToken} />
            )}
          </div>

          {/* Cost row + Submit */}
          <div className="flex flex-col gap-3">
            {effectiveToken && (
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className="text-muted-foreground">You pay</span>
                <span
                  aria-hidden
                  className="flex-1 border-b border-dotted border-border mb-1 opacity-50"
                />
                <span className="font-mono text-money">
                  {amountStr} {effectiveToken.symbol}
                </span>
              </div>
            )}
            {insufficient && effectiveToken && (
              <p className="text-xs font-sans text-destructive leading-snug">
                You need {amountStr} {effectiveToken.symbol}. Top up in MiniPay or
                pick another token above.
              </p>
            )}
            <Button
              disabled={!canSubmit}
              onClick={() => {
                if (canSubmit && effectiveToken) {
                  // Only forward context for the URL currently in the box, and only
                  // when the preview actually resolved with usable text.
                  const ctx: EventContext | null =
                    isUrl && urlPreview && !urlPreview.error && (urlPreview.title || urlPreview.description)
                      ? {
                          title: urlPreview.title,
                          description: urlPreview.description,
                          host: urlPreview.host,
                          kind: urlPreview.kind,
                        }
                      : null;
                  onSubmit({
                    eventUrl: parsed?.url ?? null,
                    eventDescription: input.trim(),
                    token: effectiveToken,
                    eventContext: ctx,
                  });
                }
              }}
            >
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                  Drafting sample…
                </>
              ) : !effectiveToken
                ? 'Select token'
                : insufficient
                  ? `Not enough ${effectiveToken.symbol}`
                  : `Generate for ${amountStr} ${effectiveToken.symbol} →`}
            </Button>
          </div>
        </div>
      </TerminalPanel>
    </section>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: clean (the component is not imported anywhere yet; this catches syntax/type slips).

- [ ] **Step 3: Commit**

```bash
git add components/NewsBreakdownInput.tsx
git commit -m "feat(ui): NewsBreakdownInput — Hot Take form minus the angle row"
```

---

### Task 7: ModePicker entry + previewClient + HomeClient wiring

**Files:**
- Modify: `components/ModePicker.tsx`
- Modify: `lib/previewClient.ts:7`
- Modify: `app/HomeClient.tsx` (all sites enumerated below)

**Interfaces:**
- Consumes: `NewsBreakdownInput` + `NewsBreakdownSubmitPayload` (Task 6), `'news-breakdown'` screen (Task 5), `track` mode-5 gate (Task 4), preview route mode 5 (Task 3).
- Produces: the full user flow — picker → input → free preview → pay → generate — for mode 5.

- [ ] **Step 1: ModePicker entry**

In `components/ModePicker.tsx`:

1. Import: add `Newspaper` to the lucide import list.
2. Widen both unions (the `Props.onSelect` parameter and `Mode.id`) to:
   `'educational' | 'hot-take' | 'news-breakdown' | 'token-analysis' | 'daily-recap' | 'comparison'`
3. Extend the id-mapping comment's list: `..., daily-recap=3, comparison=4, news-breakdown=5`.
4. Insert this entry into `MODES` **directly after** the `hot-take` entry (display position II; numeral is the curated reading order, not the id):

```ts
  {
    id: 'news-breakdown',
    numeral: 'VI',
    label: 'News Breakdown',
    Icon: Newspaper,
    blurb: 'A news just dropped — what happened, why it matters, what to watch. No take, just clarity.',
    cost: '$0.003',
    badge: 'grounded · fact-checked · live data',
  },
```

- [ ] **Step 2: previewClient**

In `lib/previewClient.ts` widen the args union:

```ts
export interface PreviewArgs {
  mode: 0 | 1 | 2 | 3 | 4 | 5;
  walletAddress: string;
  topic?: string; // Mode 0 = topic; Mode 2 = token ticker
  audience?: 'beginner' | 'intermediate' | 'advanced';
  eventDescription?: string; // Modes 1 and 5
  angle?: 'bullish' | 'bearish' | 'skeptical';
  eventContext?: EventContext | null;
}
```

- [ ] **Step 3: HomeClient wiring — every site**

In `app/HomeClient.tsx` (line refs from current HEAD; re-locate by content if drifted):

1. **Imports** (~line 33): `import type { NewsBreakdownSubmitPayload } from '@/components/NewsBreakdownInput';`
2. **Dynamic component** (after the `HotTakeInput` dynamic, ~line 58):

```ts
const NewsBreakdownInput = dynamic(
  () => import('@/components/NewsBreakdownInput').then((m) => m.NewsBreakdownInput),
  { ssr: false },
);
```

3. **State** (after `hotTake`, ~line 117): `const [newsBreakdown, setNewsBreakdown] = useState<NewsBreakdownSubmitPayload | null>(null);`
4. **activeToken** (~line 127): add `?? newsBreakdown?.token` before `?? null`.
5. **Disconnect reset effect** (~line 143): add `setNewsBreakdown(null);` alongside the other setters.
6. **startGen effect** (~line 248): add before the `comparison` branch:

```ts
    } else if (newsBreakdown) {
      void startGen({
        threadId,
        chainId,
        walletAddress: address,
        tokenSymbol: newsBreakdown.token.symbol,
        tokenAddress: newsBreakdown.token.address,
        amountPaidRaw: computeTokenAmount(newsBreakdown.token).toString(),
        payTxHash: txHash,
        mode: 5,
        eventDescription: newsBreakdown.eventDescription,
        eventContext: newsBreakdown.eventContext,
      });
```

   and add `newsBreakdown` to that effect's dependency array.
7. **share-track effect** (~line 282) and **pay-track effect** (~line 295): both mode derivations become

```ts
        const mode: 0 | 1 | 2 | 3 | 4 | 5 =
          submitted ? 0 : hotTake ? 1 : tokenAnalysis ? 2 : dailyRecap ? 3 : comparison ? 4 : 5;
```

   and both dependency arrays get `newsBreakdown`.
8. **beginFlow** (~line 352): widen the payload union with `| NewsBreakdownSubmitPayload`, the `mode` param to `0 | 1 | 2 | 3 | 4 | 5`, and insert a mode-5 case into the `PreviewArgs` chain (between the `mode === 4` case and the final mode-1 fallback):

```ts
                : mode === 5
                  ? {
                      mode: 5,
                      walletAddress: address,
                      eventDescription: (payload as NewsBreakdownSubmitPayload).eventDescription,
                      eventContext: (payload as NewsBreakdownSubmitPayload).eventContext,
                    }
                  : {
```

9. **unlock** (~line 417): token chain gets `?? newsBreakdown?.token`; mode derivation same as item 7 (type `0 | 1 | 2 | 3 | 4 | 5`), and add `newsBreakdown` to the `useCallback` deps.
10. **Picker onSelect** (~line 428): mapping becomes

```ts
          const mode =
            m === 'educational' ? 0
            : m === 'hot-take' ? 1
            : m === 'token-analysis' ? 2
            : m === 'daily-recap' ? 3
            : m === 'comparison' ? 4
            : 5;
```

   and add `if (m === 'news-breakdown') setScreen('news-breakdown');` alongside the other screen setters.
11. **formNode** — add a branch (mirroring the `hot-take` one, clearing every other payload):

```tsx
    ) : screen === 'news-breakdown' ? (
      <NewsBreakdownInput
        onSubmit={async (p) => {
          setNewsBreakdown(p);
          setSubmitted(null);
          setHotTake(null);
          setTokenAnalysis(null);
          setDailyRecap(null);
          setComparison(null);
          await beginFlow(p, 5);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
        submitting={previewLoading}
      />
```

   **Also add `setNewsBreakdown(null);` to every other input's `onSubmit`** (educational, hot-take, token-analysis, daily-recap, comparison) — each currently clears all sibling payloads.
12. **preview-locked regenerate** (~line 517): payload chain gets `?? newsBreakdown`, mode derivation same as item 7.

- [ ] **Step 4: Verify types + tests + lint**

Run: `npx tsc --noEmit && pnpm test:lib && pnpm lint`
Expected: all clean. The tsc pass is the real check here — any missed union-widening site fails it.

- [ ] **Step 5: Commit**

```bash
git add components/ModePicker.tsx lib/previewClient.ts app/HomeClient.tsx
git commit -m "feat(ui): wire News Breakdown (mode 5) — picker, input screen, preview + pay flow"
```

---

### Task 8: Full verification, runtime check, ship

**Files:** none new (verification + deploy).

- [ ] **Step 1: Full local gates**

Run: `pnpm test:lib && npx tsc --noEmit && pnpm lint && pnpm build`
Expected: all pass. Paste failures verbatim if any; do not proceed on red.

- [ ] **Step 2: Runtime verify**

Invoke the project's `/verify` skill (dev server + Playwright with the mocked MiniPay wallet provider) and walk: mode picker shows News Breakdown at position II → open it → type a headline (≥10 chars) → submit → free-preview screen or generating screen appears. Confirm the picker entry copy matches the Global Constraints verbatim.

- [ ] **Step 3: Apply the DB migration to prod Supabase**

Run `supabase/migrations/0010_funnel_mode5.sql` against prod (Supabase SQL editor, or `supabase db push` if the CLI is linked). Verify:

```sql
select pg_get_constraintdef(oid) from pg_constraint where conname = 'funnel_events_mode_check';
```

Expected: `CHECK ((mode = ANY (ARRAY[0, 1, 2, 3, 4, 5])))` (formatting may vary; must include 5). Apply **before** pushing code — widening first is safe; code-first would repeat the mode-4 silent-drop bug.

- [ ] **Step 4: Push**

```bash
git push
```

(Vercel auto-deploys `main` to prod: shippost-kappa.vercel.app.)

- [ ] **Step 5: Prod acceptance**

1. On prod, run one real free preview through News Breakdown (real headline, connected test wallet).
2. Confirm a `funnel_events` row landed with `mode = 5`:

```sql
select stage, mode, created_at from public.funnel_events
where mode = 5 order by created_at desc limit 5;
```

Expected: at least `mode_select` and `submit` rows (plus `preview` if the gate allowed). This is the exact spot mode 4 failed silently — do not skip.
3. Report results to the user; a real paid mode-5 run on mainnet stays pending user action (their wallet).
