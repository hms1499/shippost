# Comparison Mode (Chain vs Chain) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new paid generation mode (on-chain id `4`, key `comparison`) that writes an X thread comparing two blockchains and always picks a data-grounded winner.

**Architecture:** A new `ModeDef` that reuses the vetted `runModeB(overrides)` orchestration exactly like `tokenAnalysis` (id 2) and `dailyRecap` (id 3). Hard data comes from DefiLlama chain TVL + 7d momentum (a new free step folded into the `coingecko` lifecycle slot); Serper adds narrative color; Groq drafts the verdict; factCheck guards it. No contract, route, or request-body change — both chains ride in the existing `topic` field encoded as `"<aKey>|<bKey>"`.

**Tech Stack:** Next.js 14 App Router, TypeScript, Vitest 4 (`*.test.ts` colocated), DefiLlama free HTTP API, existing x402 settle pipeline.

## Global Constraints

- **Mode id is append-only.** `comparison.id = 4`. Never renumber existing modes 0–3 (emitted as `uint8 mode` in `ThreadRequested`). — from spec.
- **Settle gates delivery.** Do NOT modify `runModeB` internals; pass overrides only. Content emits must stay after the Groq settle. — from spec / CLAUDE.md.
- **`preview()` never settles, never spends from AgentWallet, never persists.** All preview fetches are free (`fetchChainTvl`, `fetchSerper`, `generateTweets`). — from spec.
- **No route/body change.** Two chains encode into the existing `topic` string (`ModeInputBody` unchanged). — from spec.
- **Grounding is soft.** DefiLlama/Serper failures degrade to a thinner draft; the thread still ships. factCheck still runs. — from spec.
- **DefiLlama fetches carry no x402 settle** and are excluded from cost (the `coingecko` step is skipped in `runModeB`'s `wrappedEmit`). Cost stays Serper + Groq + factCheck = 3 settles. — from spec.
- Run a single test file with: `npx vitest run <path>`. Lint/type-check with `pnpm lint`.

---

### Task 1: DefiLlama chain TVL fetch + summary

**Files:**
- Modify: `lib/pipeline/defiLlamaStep.ts` (append new exports after `fetchDefiOverview`)
- Test: `lib/pipeline/defiLlamaStep.test.ts` (add a `describe` block; create the file if it does not exist)

**Interfaces:**
- Produces:
  - `interface ChainTvl { tvlUsd: number; change7dPct: number | null }`
  - `fetchChainTvl(chainName: string): Promise<ChainTvl | null>` — resolves a DefiLlama chain by exact `name` from `/v2/chains`; adds 7d momentum from `/v2/historicalChainTvl/{chain}`; soft-returns `null` on any failure or no match.
  - `summarizeChainTvl(aLabel: string, a: ChainTvl | null, bLabel: string, b: ChainTvl | null): string | null` — one line per chain, or `null` when both are `null`.

- [ ] **Step 1: Write the failing test**

Add to `lib/pipeline/defiLlamaStep.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { summarizeChainTvl } from './defiLlamaStep';

describe('summarizeChainTvl', () => {
  it('returns null when both chains have no TVL', () => {
    expect(summarizeChainTvl('Solana', null, 'Base', null)).toBeNull();
  });

  it('emits one line per chain with signed 7d momentum', () => {
    const out = summarizeChainTvl(
      'Solana',
      { tvlUsd: 9_100_000_000, change7dPct: 4.2 },
      'Base',
      { tvlUsd: 3_400_000_000, change7dPct: -1.5 },
    );
    expect(out).toContain('Solana: TVL $9.10B (+4.2% 7d)');
    expect(out).toContain('Base: TVL $3.40B (-1.5% 7d)');
  });

  it('omits the 7d clause when momentum is null and keeps the present chain when the other is null', () => {
    const out = summarizeChainTvl('Celo', { tvlUsd: 120_000_000, change7dPct: null }, 'Base', null);
    expect(out).toBe('Celo: TVL $120.0M');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pipeline/defiLlamaStep.test.ts`
Expected: FAIL — `summarizeChainTvl` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `lib/pipeline/defiLlamaStep.ts` (reuses the existing `usdCompact`, `signedPct`, `retryOnce`, `LLAMA_BASE`, and `ChainRow` already in the file):

```typescript
export interface ChainTvl {
  tvlUsd: number;
  change7dPct: number | null;
}

// 7d TVL momentum for a chain from the historical series. Soft: null on any
// failure — momentum is additive color, absolute TVL is the anchor.
async function fetchChain7dPct(chain: string, currentTvl: number): Promise<number | null> {
  try {
    const series = await retryOnce(async () => {
      const res = await fetch(`${LLAMA_BASE}/v2/historicalChainTvl/${encodeURIComponent(chain)}`);
      if (!res.ok) throw new Error(`DefiLlama ${res.status}`);
      const j = (await res.json()) as Array<{ date?: number; tvl?: number }>;
      if (!Array.isArray(j)) throw new Error('DefiLlama historicalChainTvl shape');
      return j;
    });
    // Points are daily; index from the end for ~7 days ago.
    const past = series[series.length - 8];
    const pastTvl = past?.tvl;
    if (typeof pastTvl !== 'number' || pastTvl <= 0) return null;
    return ((currentTvl - pastTvl) / pastTvl) * 100;
  } catch {
    return null;
  }
}

// Resolve a chain's current TVL (by exact DefiLlama name) + 7d momentum. Soft:
// null when the chain isn't found or the API fails, so a comparison still ships
// on the other chain + Serper narrative.
export async function fetchChainTvl(chainName: string): Promise<ChainTvl | null> {
  let rows: ChainRow[];
  try {
    rows = await retryOnce(async () => {
      const res = await fetch(`${LLAMA_BASE}/v2/chains`);
      if (!res.ok) throw new Error(`DefiLlama ${res.status}`);
      const j = (await res.json()) as ChainRow[];
      if (!Array.isArray(j)) throw new Error('DefiLlama /v2/chains shape');
      return j;
    });
  } catch {
    return null;
  }
  const hit = rows.find((c) => c.name === chainName && typeof c.tvl === 'number' && c.tvl! > 0);
  if (!hit) return null;
  const tvlUsd = hit.tvl!;
  const change7dPct = await fetchChain7dPct(chainName, tvlUsd);
  return { tvlUsd, change7dPct };
}

// One line per chain: "Solana: TVL $9.10B (+4.2% 7d)". Drops a null chain and
// returns null only when neither chain resolved (both-null → no hard data).
export function summarizeChainTvl(
  aLabel: string,
  a: ChainTvl | null,
  bLabel: string,
  b: ChainTvl | null,
): string | null {
  const line = (label: string, c: ChainTvl | null): string | null => {
    if (!c) return null;
    const mom = c.change7dPct !== null ? ` (${signedPct(c.change7dPct)} 7d)` : '';
    return `${label}: TVL ${usdCompact(c.tvlUsd)}${mom}`;
  };
  const parts = [line(aLabel, a), line(bLabel, b)].filter((s): s is string => Boolean(s));
  return parts.length ? parts.join('\n') : null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pipeline/defiLlamaStep.test.ts`
Expected: PASS (all `summarizeChainTvl` cases).

Note: `usdCompact(9_100_000_000)` returns `$9.10B` and `usdCompact(120_000_000)` returns `$120.0M` per the existing helper — the assertions above match those exact formats.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/defiLlamaStep.ts lib/pipeline/defiLlamaStep.test.ts
git commit -m "feat(comparison): DefiLlama chain TVL + 7d momentum fetch and summary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Chain whitelist + prompt builder

**Files:**
- Create: `lib/prompts/comparison.ts`
- Test: `lib/prompts/comparison.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface ChainEntry { key: string; label: string; defiLlamaName: string }`
  - `CHAINS: ChainEntry[]` — the ~14-chain whitelist (single source of truth for server + client dropdown).
  - `CHAIN_BY_KEY: Record<string, ChainEntry>`
  - `parseChains(topic: string | undefined): [ChainEntry, ChainEntry] | null` — splits `"solana|base"`, validates both keys against the whitelist, rejects equal keys; returns `null` on any problem.
  - `serperQueryFor(aLabel: string, bLabel: string): string`
  - `buildComparisonPrompt(input: { aLabel: string; bLabel: string; chainData: string | null; searchSummary: string | null }): string`

- [ ] **Step 1: Write the failing test**

Create `lib/prompts/comparison.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { CHAINS, parseChains, serperQueryFor, buildComparisonPrompt } from './comparison';

describe('CHAINS whitelist', () => {
  it('has unique keys and non-empty DefiLlama names', () => {
    const keys = CHAINS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of CHAINS) {
      expect(c.key).toMatch(/^[a-z0-9-]+$/);
      expect(c.defiLlamaName.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
});

describe('parseChains', () => {
  it('returns the two entries for a valid distinct pair', () => {
    const out = parseChains('solana|base');
    expect(out?.[0].key).toBe('solana');
    expect(out?.[1].key).toBe('base');
  });

  it('rejects equal chains', () => {
    expect(parseChains('base|base')).toBeNull();
  });

  it('rejects an unknown chain', () => {
    expect(parseChains('solana|notachain')).toBeNull();
  });

  it('rejects missing / malformed input', () => {
    expect(parseChains(undefined)).toBeNull();
    expect(parseChains('solana')).toBeNull();
    expect(parseChains('')).toBeNull();
  });
});

describe('serperQueryFor', () => {
  it('names both chains', () => {
    const q = serperQueryFor('Solana', 'Base');
    expect(q).toContain('Solana');
    expect(q).toContain('Base');
  });
});

describe('buildComparisonPrompt', () => {
  it('names both chains and demands a single winner', () => {
    const p = buildComparisonPrompt({
      aLabel: 'Solana',
      bLabel: 'Base',
      chainData: 'Solana: TVL $9.10B (+4.2% 7d)\nBase: TVL $3.40B (-1.5% 7d)',
      searchSummary: null,
    });
    expect(p).toContain('Solana');
    expect(p).toContain('Base');
    expect(p.toLowerCase()).toContain('winner');
  });

  it('warns against inventing numbers when chain data is present', () => {
    const p = buildComparisonPrompt({ aLabel: 'Celo', bLabel: 'Base', chainData: 'Celo: TVL $120.0M', searchSummary: null });
    expect(p.toLowerCase()).toContain('do not invent');
  });

  it('handles absent grounding without throwing', () => {
    const p = buildComparisonPrompt({ aLabel: 'Sui', bLabel: 'Aptos', chainData: null, searchSummary: null });
    expect(p).toContain('Sui');
    expect(p).toContain('Aptos');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/prompts/comparison.test.ts`
Expected: FAIL — module `./comparison` not found.

- [ ] **Step 3: Write minimal implementation**

Create `lib/prompts/comparison.ts`:

```typescript
// Chain-vs-chain comparison mode (id 4). One whitelist drives both server-side
// validation and the client dropdown. `defiLlamaName` MUST equal the exact
// `name` field DefiLlama's /v2/chains returns, or TVL won't resolve.
export interface ChainEntry {
  key: string; // stable machine key, used in the `topic` wire value
  label: string; // display name in the UI + prompt
  defiLlamaName: string; // exact /v2/chains name
}

export const CHAINS: ChainEntry[] = [
  { key: 'ethereum', label: 'Ethereum', defiLlamaName: 'Ethereum' },
  { key: 'solana', label: 'Solana', defiLlamaName: 'Solana' },
  { key: 'base', label: 'Base', defiLlamaName: 'Base' },
  { key: 'arbitrum', label: 'Arbitrum', defiLlamaName: 'Arbitrum' },
  { key: 'optimism', label: 'Optimism', defiLlamaName: 'OP Mainnet' },
  { key: 'polygon', label: 'Polygon', defiLlamaName: 'Polygon' },
  { key: 'bsc', label: 'BNB Chain', defiLlamaName: 'BSC' },
  { key: 'avalanche', label: 'Avalanche', defiLlamaName: 'Avalanche' },
  { key: 'sui', label: 'Sui', defiLlamaName: 'Sui' },
  { key: 'aptos', label: 'Aptos', defiLlamaName: 'Aptos' },
  { key: 'tron', label: 'Tron', defiLlamaName: 'Tron' },
  { key: 'celo', label: 'Celo', defiLlamaName: 'Celo' },
  { key: 'blast', label: 'Blast', defiLlamaName: 'Blast' },
  { key: 'zksync', label: 'zkSync Era', defiLlamaName: 'zkSync Era' },
];

export const CHAIN_BY_KEY: Record<string, ChainEntry> = Object.fromEntries(
  CHAINS.map((c) => [c.key, c]),
);

// Decode the two chains carried in the request `topic` field ("solana|base").
// Returns null (→ 400 upstream) on anything malformed: wrong arity, unknown
// key, or the same chain twice.
export function parseChains(topic: string | undefined): [ChainEntry, ChainEntry] | null {
  if (!topic) return null;
  const parts = topic.split('|').map((s) => s.trim().toLowerCase());
  if (parts.length !== 2) return null;
  const [aKey, bKey] = parts;
  if (aKey === bKey) return null;
  const a = CHAIN_BY_KEY[aKey];
  const b = CHAIN_BY_KEY[bKey];
  if (!a || !b) return null;
  return [a, b];
}

export function serperQueryFor(aLabel: string, bLabel: string): string {
  return `${aLabel} vs ${bLabel} blockchain ecosystem TVL activity growth 2026`;
}

const STRUCTURE = `Structure:
- T1: hook — frame the matchup and state, in the opening tweet, which chain wins.
- T2..T(n-2): the case for the winner — one comparative signal per tweet (TVL, 7d TVL momentum, ecosystem activity from the search context). Every number MUST come from the data below.
- T(n-1): the loser's genuine strength — one honest tweet on where the losing chain is ahead or catching up. This is required; it keeps the thread analysis, not shilling.
- T(n): "one thing to watch" for the loser — a concrete, observable signal that would flip the verdict.

Constraints:
- Pick exactly ONE winner and never waffle back on it.
- Do not invent a TVL figure, percentage, or ranking. Use ONLY numbers in the chain data / search context below. If a number isn't provided, argue qualitatively.
- Compare the two named chains only. Don't drift into a third chain unless the search context ties it directly to this matchup.`;

const LENGTH_GUIDANCE = `Length: 5–9 tweets. Never fewer than 4, never more than 10. Stop once the verdict, the loser's strength, and the watch-signal are all covered.`;

export function buildComparisonPrompt(input: {
  aLabel: string;
  bLabel: string;
  chainData: string | null;
  searchSummary: string | null;
}): string {
  const blocks = [
    `Write an X thread comparing two blockchains and pick a single winner: ${input.aLabel} vs ${input.bLabel}.`,
  ];

  if (input.chainData) {
    blocks.push(`Chain data (ground truth — every number you cite must come from here):\n${input.chainData}`);
  } else {
    blocks.push(`Chain data: (none returned — do NOT state any TVL number or percentage; make the call qualitatively from the search context and general knowledge)`);
  }

  if (input.searchSummary) {
    blocks.push(`Search context (ground truth for ecosystem activity / narrative):\n${input.searchSummary}`);
  } else {
    blocks.push(`Search context: (none returned — keep claims general; do not invent specifics)`);
  }

  blocks.push(LENGTH_GUIDANCE);
  blocks.push(STRUCTURE);
  blocks.push('Output only the numbered tweets separated by blank lines. Nothing else.');
  return blocks.join('\n\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/prompts/comparison.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/prompts/comparison.ts lib/prompts/comparison.test.ts
git commit -m "feat(comparison): chain whitelist, topic parser, verdict prompt

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Comparison ModeDef + registry

**Files:**
- Create: `lib/pipeline/modes/comparison.ts`
- Modify: `lib/pipeline/modes/index.ts` (import + register in `MODES`)
- Test: `lib/pipeline/modes/comparison.test.ts` (new) and `lib/pipeline/modes/index.test.ts` (extend)

**Interfaces:**
- Consumes:
  - From Task 1: `fetchChainTvl`, `summarizeChainTvl`, `ChainTvl` (`@/lib/pipeline/defiLlamaStep`).
  - From Task 2: `CHAINS`, `parseChains`, `serperQueryFor`, `buildComparisonPrompt` (`@/lib/prompts/comparison`).
  - Existing: `runModeB` (`@/lib/pipeline/runModeB`), `summarizeSerper` (`@/lib/prompts/modeB`), `fetchSerper` (`@/lib/pipeline/serperStep`), `generateTweets` (`@/lib/pipeline/generateDraft`), `SYSTEM_PROMPT` (`@/lib/prompts/system`), `ModeDef` (`./types`).
- Produces: `comparisonMode: ModeDef` (id 4, key `comparison`), registered so `getMode(4)` resolves it.

- [ ] **Step 1: Write the failing test**

Create `lib/pipeline/modes/comparison.test.ts`. It mocks `runModeB` and asserts the overrides seam, mirroring `runModeB.test.ts` style:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const runModeB = vi.fn(async () => ({
  tweets: ['1/ x'],
  totalCostUsd: '0.003',
  searchSummary: null,
  marketSnippet: 'Solana: TVL $9.10B (+4.2% 7d)\nBase: TVL $3.40B (-1.5% 7d)',
}));
vi.mock('@/lib/pipeline/runModeB', () => ({ runModeB }));
vi.mock('@/lib/pipeline/defiLlamaStep', () => ({
  fetchChainTvl: vi.fn(async () => ({ tvlUsd: 1_000_000_000, change7dPct: 1 })),
  summarizeChainTvl: vi.fn(() => 'A: TVL $1.00B (+1.0% 7d)'),
}));
vi.mock('@/lib/pipeline/serperStep', () => ({ fetchSerper: vi.fn() }));
vi.mock('@/lib/pipeline/generateDraft', () => ({ generateTweets: vi.fn(async () => ['1/ x']) }));

const { comparisonMode } = await import('./comparison');

const baseCtx = {
  chainId: 42220,
  threadId: 1n,
  topic: 'solana|base',
  audience: 'beginner' as const,
  agentWallet: '0x0000000000000000000000000000000000000000' as const,
};

describe('comparisonMode.validateInput', () => {
  it('accepts a valid distinct pair', () => {
    expect(comparisonMode.validateInput({ topic: 'solana|base' })).toBeNull();
  });
  it('rejects equal chains', () => {
    expect(comparisonMode.validateInput({ topic: 'base|base' })).not.toBeNull();
  });
  it('rejects an unknown chain', () => {
    expect(comparisonMode.validateInput({ topic: 'solana|nope' })).not.toBeNull();
  });
  it('rejects missing topic', () => {
    expect(comparisonMode.validateInput({})).not.toBeNull();
  });
});

describe('comparisonMode.run', () => {
  beforeEach(() => runModeB.mockClear());

  it('passes a serperQuery naming both chains and a comparison buildPrompt', async () => {
    await comparisonMode.run({ ...baseCtx }, { topic: 'solana|base' }, () => {});
    expect(runModeB).toHaveBeenCalledTimes(1);
    const overrides = runModeB.mock.calls[0][0];
    expect(overrides.serperQuery).toContain('Solana');
    expect(overrides.serperQuery).toContain('Base');
    const prompt = overrides.buildPrompt({ searchSummary: null, marketSnippet: 'A: TVL $1.00B (+1.0% 7d)' });
    expect(prompt.toLowerCase()).toContain('winner');
  });
});
```

Extend `lib/pipeline/modes/index.test.ts`:
- Add the mock alongside the existing ones (so importing the registry doesn't drag in the real pipeline):

```typescript
vi.mock('@/lib/pipeline/defiLlamaStep', () => ({
  fetchChainTvl: vi.fn(),
  summarizeChainTvl: vi.fn(),
  fetchDefiOverview: vi.fn(),
}));
```

- Add a registry assertion:

```typescript
it('maps id 4 to the comparison mode', () => {
  expect(getMode(4)?.id).toBe(4);
  expect(getMode(4)?.key).toBe('comparison');
});
```

(Leave the existing `getMode(7)` "unknown" test as-is — 7 is still unregistered.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/pipeline/modes/comparison.test.ts lib/pipeline/modes/index.test.ts`
Expected: FAIL — `./comparison` not found; `getMode(4)` is `null`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/pipeline/modes/comparison.ts`:

```typescript
// lib/pipeline/modes/comparison.ts
import { runModeB } from '@/lib/pipeline/runModeB';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { summarizeSerper } from '@/lib/prompts/modeB';
import { generateTweets } from '@/lib/pipeline/generateDraft';
import { fetchSerper } from '@/lib/pipeline/serperStep';
import { fetchChainTvl, summarizeChainTvl } from '@/lib/pipeline/defiLlamaStep';
import {
  parseChains,
  serperQueryFor,
  buildComparisonPrompt,
  type ChainEntry,
} from '@/lib/prompts/comparison';
import type { PipelineContext, PipelineEvent } from '@/lib/pipeline/types';
import type { ModeDef } from './types';

// Free, no-settle market step: fetch both chains' TVL from DefiLlama in
// parallel and emit under the 'coingecko' lifecycle slot (same fold Daily
// Recap uses). Returns null only when NEITHER chain resolved.
async function chainMarketStep(
  a: ChainEntry,
  b: ChainEntry,
  emit: (e: PipelineEvent) => void,
): Promise<string | null> {
  emit({ type: 'step_started', step: 'coingecko' });
  let snippet: string | null = null;
  try {
    const [ta, tb] = await Promise.all([
      fetchChainTvl(a.defiLlamaName),
      fetchChainTvl(b.defiLlamaName),
    ]);
    snippet = summarizeChainTvl(a.label, ta, b.label, tb);
  } catch (e) {
    console.error('[comparison] chain TVL failed, continuing:', e instanceof Error ? e.message : e);
  }
  emit({ type: 'step_output', step: 'coingecko', output: snippet });
  emit({
    type: 'step_settled',
    step: 'coingecko',
    txHash: '0x0',
    costAmount: '0.000',
    tokenSymbol: 'cUSD',
  });
  return snippet;
}

export const comparisonMode: ModeDef = {
  id: 4,
  key: 'comparison',
  validateInput(b) {
    if (!parseChains(b.topic)) return 'two distinct whitelisted chains required for Comparison';
    return null;
  },
  async run(ctx, body, emit) {
    // validateInput already gated this; non-null by contract.
    const [a, b] = parseChains(body.topic)!;
    const out = await runModeB(
      {
        ...ctx,
        angle: 'skeptical', // required by type; buildPrompt fully overrides it
        eventDescription: `${a.label} vs ${b.label}`, // fallback only
        serperQuery: serperQueryFor(a.label, b.label),
        serperOpts: { recency: 'qdr:m' },
        marketStep: (c: PipelineContext, e) => chainMarketStep(a, b, e),
        buildPrompt: ({ searchSummary, marketSnippet }) =>
          buildComparisonPrompt({ aLabel: a.label, bLabel: b.label, chainData: marketSnippet, searchSummary }),
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
    const pair = parseChains(input.topic);
    if (!pair) return { tweets: [] };
    const [a, b] = pair;
    let searchSummary: string | null = null;
    try {
      const s = await fetchSerper(serperQueryFor(a.label, b.label), { recency: 'qdr:m' });
      searchSummary = summarizeSerper(s.organic, s.newsSnippet);
    } catch (e) {
      console.error('[comparison.preview] serper failed, continuing:', e instanceof Error ? e.message : e);
    }
    let chainData: string | null = null;
    try {
      const [ta, tb] = await Promise.all([
        fetchChainTvl(a.defiLlamaName),
        fetchChainTvl(b.defiLlamaName),
      ]);
      chainData = summarizeChainTvl(a.label, ta, b.label, tb);
    } catch (e) {
      console.error('[comparison.preview] chain TVL failed, continuing:', e instanceof Error ? e.message : e);
    }
    const messages = [
      { role: 'system' as const, content: SYSTEM_PROMPT },
      { role: 'user' as const, content: buildComparisonPrompt({ aLabel: a.label, bLabel: b.label, chainData, searchSummary }) },
    ];
    return { tweets: await generateTweets({ messages, temperature: 0.85, maxTokens: 1400 }) };
  },
};
```

Modify `lib/pipeline/modes/index.ts` — add the import and the `MODES` entry:

```typescript
import { comparisonMode } from './comparison';
```

```typescript
export const MODES: Record<number, ModeDef> = {
  [educationalMode.id]: educationalMode,
  [hotTakeMode.id]: hotTakeMode,
  [tokenAnalysisMode.id]: tokenAnalysisMode,
  [dailyRecapMode.id]: dailyRecapMode,
  [comparisonMode.id]: comparisonMode,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/pipeline/modes/comparison.test.ts lib/pipeline/modes/index.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline/modes/comparison.ts lib/pipeline/modes/index.ts lib/pipeline/modes/comparison.test.ts lib/pipeline/modes/index.test.ts
git commit -m "feat(comparison): ModeDef id 4 reusing runModeB, registered

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Widen analytics to accept mode 4

**Files:**
- Modify: `lib/funnelTypes.ts:25-26,33` (`isValidMode`, `FunnelEventInput.mode`)
- Modify: `lib/funnel.ts:38` (client emit filter)
- Modify: `lib/funnelReport.ts:35,51-56` (`byMode` Record)
- Modify: `lib/previewClient.ts:7` (`PreviewArgs.mode`)
- Test: `lib/funnelTypes.test.ts:29-36` (update expectation)

**Interfaces:**
- Consumes: nothing.
- Produces: mode `4` accepted everywhere the analytics/preview types enumerate `0 | 1 | 2 | 3`.

- [ ] **Step 1: Write the failing test**

In `lib/funnelTypes.test.ts`, change the `isValidMode` case to accept 4 and reject 5:

```typescript
it('isValidMode accepts 0–4 and null/undefined, rejects the rest', () => {
  expect(isValidMode(0)).toBe(true);
  expect(isValidMode(2)).toBe(true);
  expect(isValidMode(3)).toBe(true);
  expect(isValidMode(4)).toBe(true);
  expect(isValidMode(null)).toBe(true);
  expect(isValidMode(undefined)).toBe(true);
  expect(isValidMode(5)).toBe(false);
  expect(isValidMode('1')).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/funnelTypes.test.ts`
Expected: FAIL — `isValidMode(4)` currently returns `false`.

- [ ] **Step 3: Write minimal implementation**

`lib/funnelTypes.ts` — line 25-27:

```typescript
export function isValidMode(v: unknown): v is 0 | 1 | 2 | 3 | 4 | null | undefined {
  return v === null || v === undefined || v === 0 || v === 1 || v === 2 || v === 3 || v === 4;
}
```

`lib/funnelTypes.ts` — line 33:

```typescript
  mode?: 0 | 1 | 2 | 3 | 4 | null;
```

`lib/funnel.ts` — line 38 (both `track` overloads use the same guard; update the emit filter):

```typescript
  if (opts.mode === 0 || opts.mode === 1 || opts.mode === 2 || opts.mode === 3 || opts.mode === 4) payload.mode = opts.mode;
```

`lib/funnelReport.ts` — line 35 (type) and lines 51-56 (init):

```typescript
  byMode: Record<0 | 1 | 2 | 3 | 4, StageCounts>;
```

```typescript
  const byMode = {
    0: distinctPerStage(rows.filter((r) => r.mode === 0)),
    1: distinctPerStage(rows.filter((r) => r.mode === 1)),
    2: distinctPerStage(rows.filter((r) => r.mode === 2)),
    3: distinctPerStage(rows.filter((r) => r.mode === 3)),
    4: distinctPerStage(rows.filter((r) => r.mode === 4)),
  } as Record<0 | 1 | 2 | 3 | 4, StageCounts>;
```

`lib/previewClient.ts` — line 7:

```typescript
  mode: 0 | 1 | 2 | 3 | 4;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/funnelTypes.test.ts lib/funnelReport.test.ts`
Expected: PASS. (If `funnelReport.test.ts` doesn't exist, run only the first.)

- [ ] **Step 5: Commit**

```bash
git add lib/funnelTypes.ts lib/funnel.ts lib/funnelReport.ts lib/previewClient.ts lib/funnelTypes.test.ts
git commit -m "feat(comparison): accept mode 4 across funnel analytics + preview args

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Client — input component, mode picker, and HomeClient wiring

**Files:**
- Create: `components/ChainComparisonInput.tsx`
- Modify: `components/ModePicker.tsx` (add `'comparison'` id + entry)
- Modify: `lib/screens.ts` (add `'comparison'` to `Screen` + `INPUT_SCREENS`)
- Modify: `app/HomeClient.tsx` (state, wiring, render, back-nav, mode unions)

**Interfaces:**
- Consumes: `CHAINS` from `@/lib/prompts/comparison`; `comparisonMode` (already registered) via mode 4; `useBalances`, `TokenSelector`, `computeTokenAmount`, `TerminalPanel`, `RuleDivider`, `Button` (existing).
- Produces: `ChainComparisonSubmitPayload { aKey: string; bKey: string; token: TokenBalance }`; a `'comparison'` screen; body/preview built with `mode: 4, topic: "<aKey>|<bKey>"`.

This task has no unit test (React UI + stateful container). Verification is a type-check + manual dev-server pass at the end.

- [ ] **Step 1: Add the `Screen` value**

`lib/screens.ts` — add `'comparison'` to both the union and `INPUT_SCREENS`:

```typescript
export type Screen =
  | 'mode'
  | 'educational'
  | 'hot-take'
  | 'token-analysis'
  | 'daily-recap'
  | 'comparison'
  | 'preview-locked'
  | 'generating'
  | 'preview'
  | 'post-share';

const INPUT_SCREENS: readonly Screen[] = ['mode', 'educational', 'hot-take', 'token-analysis', 'daily-recap', 'comparison'];
```

- [ ] **Step 2: Create the input component**

Create `components/ChainComparisonInput.tsx` (modeled on `TokenAnalysisInput.tsx`; two `<select>` dropdowns from `CHAINS`, A ≠ B, no angle):

```tsx
'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, GitCompare, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { TokenSelector } from './TokenSelector';
import { useBalances } from '@/lib/useBalances';
import type { TokenBalance } from '@/lib/useBalances';
import { computeTokenAmount } from '@/lib/tokens';
import { CHAINS } from '@/lib/prompts/comparison';
import { formatUnits } from 'viem';

export interface ChainComparisonSubmitPayload {
  aKey: string;
  bKey: string;
  token: TokenBalance;
}

interface Props {
  onSubmit: (p: ChainComparisonSubmitPayload) => void;
  onBack?: () => void;
  disabled?: boolean;
  submitting?: boolean;
}

export function ChainComparisonInput({ onSubmit, onBack, disabled, submitting }: Props) {
  const { balances, isLoading } = useBalances();
  const [aKey, setAKey] = useState('solana');
  const [bKey, setBKey] = useState('base');

  const distinct = aKey !== bKey;

  const defaultToken = useMemo(() => {
    if (!balances.length) return null;
    return [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
  }, [balances]);
  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const effectiveToken = selectedToken ?? defaultToken;
  const insufficient =
    effectiveToken !== null && effectiveToken.balance < computeTokenAmount(effectiveToken);

  const canSubmit =
    distinct && effectiveToken !== null && !insufficient && !disabled && !submitting;

  const amountStr = effectiveToken
    ? Number(formatUnits(computeTokenAmount(effectiveToken), effectiveToken.decimals)).toFixed(2)
    : '';

  const selectClass =
    'flex-1 rounded-md border border-input bg-card px-3 py-2 font-mono text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50';

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
            <GitCompare size={18} className="text-primary shrink-0" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <p className="heading-sub text-[10px]">Chain comparison</p>
              <h2 className="font-mono font-bold text-xl leading-tight tracking-tight">
                Pick two chains
              </h2>
            </div>
          </div>
          <p className="text-sm font-sans text-muted-foreground leading-snug">
            The agent reads each chain&apos;s TVL &amp; momentum, then calls a winner.
          </p>

          <RuleDivider />

          <div className="flex flex-col gap-2">
            <label htmlFor="chain-a" className="heading-sub text-[10px]">Chain A</label>
            <select id="chain-a" value={aKey} disabled={disabled} onChange={(e) => setAKey(e.target.value)} className={selectClass}>
              {CHAINS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="chain-b" className="heading-sub text-[10px]">Chain B</label>
            <select id="chain-b" value={bKey} disabled={disabled} onChange={(e) => setBKey(e.target.value)} className={selectClass}>
              {CHAINS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            {!distinct && (
              <p className="text-xs font-sans text-destructive leading-snug">Pick two different chains.</p>
            )}
          </div>

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

          <div className="flex flex-col gap-3">
            {effectiveToken && (
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className="text-muted-foreground">You pay</span>
                <span aria-hidden className="flex-1 border-b border-dotted border-border mb-1 opacity-50" />
                <span className="font-mono text-money">{amountStr} {effectiveToken.symbol}</span>
              </div>
            )}
            {insufficient && effectiveToken && (
              <p className="text-xs font-sans text-destructive leading-snug">
                You need {amountStr} {effectiveToken.symbol}. Top up in MiniPay or pick another token above.
              </p>
            )}
            <Button
              disabled={!canSubmit}
              onClick={() => {
                if (canSubmit && effectiveToken) onSubmit({ aKey, bKey, token: effectiveToken });
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
                  : `Compare for ${amountStr} ${effectiveToken.symbol} →`}
            </Button>
          </div>
        </div>
      </TerminalPanel>
    </section>
  );
}
```

- [ ] **Step 3: Add the ModePicker entry**

`components/ModePicker.tsx`:
- Widen the `onSelect` prop union and the `Mode.id` union to add `'comparison'`:

```typescript
interface Props {
  onSelect: (mode: 'educational' | 'hot-take' | 'token-analysis' | 'daily-recap' | 'comparison') => void;
}
```
```typescript
interface Mode {
  id: 'educational' | 'hot-take' | 'token-analysis' | 'daily-recap' | 'comparison';
```
- Import `GitCompare` from `lucide-react` (add to the existing import line).
- Append this entry to the `MODES` array (after `daily-recap`):

```typescript
  {
    id: 'comparison',
    numeral: 'V',
    label: 'Chain Comparison',
    Icon: GitCompare,
    blurb: 'Two chains enter, one wins. TVL, momentum & ecosystem activity — the agent calls it.',
    cost: '$0.003',
    badge: 'grounded · TVL · fact-checked',
  },
```

- [ ] **Step 4: Wire HomeClient**

`app/HomeClient.tsx` — make these edits (mirror the `tokenAnalysis` lines throughout):

1. Import the component and payload type (near the other `dynamic(...)` imports and `import type` lines):

```typescript
import type { ChainComparisonSubmitPayload } from '@/components/ChainComparisonInput';
```
```typescript
const ChainComparisonInput = dynamic(
  () => import('@/components/ChainComparisonInput').then((m) => m.ChainComparisonInput),
  { ssr: false },
);
```

2. Add state (after the `dailyRecap` state, ~line 112):

```typescript
  const [comparison, setComparison] = useState<ChainComparisonSubmitPayload | null>(null);
```

3. `activeToken` (~line 119) — append `?? comparison?.token`:

```typescript
  const activeToken =
    submitted?.token ?? hotTake?.token ?? tokenAnalysis?.token ?? dailyRecap?.token ?? comparison?.token ?? null;
```

4. Disconnect reset effect (~line 135) — add `setComparison(null);` beside `setDailyRecap(null);`.

5. `startGen` chain (~line 228, after the `dailyRecap` branch) — add:

```typescript
    } else if (comparison) {
      void startGen({
        threadId,
        chainId,
        walletAddress: address,
        tokenSymbol: comparison.token.symbol,
        tokenAddress: comparison.token.address,
        amountPaidRaw: computeTokenAmount(comparison.token).toString(),
        payTxHash: txHash,
        mode: 4,
        // Both chains ride in on `topic` as "<aKey>|<bKey>".
        topic: `${comparison.aKey}|${comparison.bKey}`,
      });
    }
```
   Also add `comparison` to that effect's dependency array (beside `dailyRecap`).

6. Widen every `mode: 0 | 1 | 2 | 3` union to `0 | 1 | 2 | 3 | 4` and extend each ternary with the `comparison` case. Exact sites:
   - line ~260 (share track): `const mode: 0 | 1 | 2 | 3 | 4 = submitted ? 0 : hotTake ? 1 : tokenAnalysis ? 2 : dailyRecap ? 3 : 4;`
   - line ~266 dependency array: add `comparison`.
   - line ~337 `beginFlow` param: `mode: 0 | 1 | 2 | 3 | 4,`
   - `beginFlow` `PreviewArgs` build (~line 344): add a `mode === 4` branch before the final `mode: 1` fallback:

```typescript
            : mode === 4
              ? { mode: 4, walletAddress: address, topic: `${(payload as ChainComparisonSubmitPayload).aKey}|${(payload as ChainComparisonSubmitPayload).bKey}` }
```
   - `beginFlow` payload param union (~line 332-336): add `| ChainComparisonSubmitPayload`.
   - line ~388 `unlock` token: append `?? comparison?.token`.
   - line ~390 `unlock` mode: `const mode: 0 | 1 | 2 | 3 | 4 = submitted ? 0 : hotTake ? 1 : tokenAnalysis ? 2 : dailyRecap ? 3 : 4;` and add `comparison` to its dependency array (~line 393).

7. ModePicker `onSelect` (~line 398): extend the ternary + add the screen switch:

```typescript
          const mode =
            m === 'educational' ? 0 : m === 'hot-take' ? 1 : m === 'token-analysis' ? 2 : m === 'daily-recap' ? 3 : 4;
```
```typescript
          if (m === 'comparison') setScreen('comparison');
```

8. Render branch (~after the `daily-recap` branch, before the closing of the `formNode` ternary) — add:

```tsx
    ) : screen === 'comparison' ? (
      <ChainComparisonInput
        onSubmit={async (p) => {
          setComparison(p);
          setSubmitted(null);
          setHotTake(null);
          setTokenAnalysis(null);
          setDailyRecap(null);
          await beginFlow(p, 4);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
        submitting={previewLoading}
      />
```
   (Ensure each other `onSubmit` that calls `setSubmitted`/`setHotTake`/etc. also adds `setComparison(null);` so switching modes clears comparison — mirror the existing null-out lines in the educational/hot-take/token-analysis/daily-recap `onSubmit` handlers.)

9. Back-nav `const back: Screen = ...` (two sites, ~line 571 and ~587): append the comparison case:

```typescript
            const back: Screen = submitted ? 'educational' : hotTake ? 'hot-take' : tokenAnalysis ? 'token-analysis' : dailyRecap ? 'daily-recap' : comparison ? 'comparison' : 'mode';
```

- [ ] **Step 5: Type-check and lint**

Run: `pnpm lint`
Expected: no errors. If the compiler flags any remaining `0 | 1 | 2 | 3` union or a missing `comparison` case, widen/extend it the same way. (`useThreadGeneration`'s `start` takes `mode: number`, so `mode: 4` needs no hook change.)

- [ ] **Step 6: Manual verification (dev server)**

Run: `pnpm dev`, then follow the CoinOp verify skill (mocked MiniPay provider) to reach the mode picker.
Expected: a fifth mode "Chain Comparison" (numeral V) appears; selecting it shows two chain dropdowns defaulting to Solana / Base; the CTA is disabled when both dropdowns match; submitting triggers the free preview (`/api/preview` with `mode: 4`).

- [ ] **Step 7: Commit**

```bash
git add components/ChainComparisonInput.tsx components/ModePicker.tsx lib/screens.ts app/HomeClient.tsx
git commit -m "feat(comparison): client input, mode picker entry, HomeClient wiring

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Full test + build gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full lib/app test suite**

Run: `pnpm test:lib`
Expected: PASS (all existing + new tests). The preview source-guard test now also covers `comparisonMode` (asserts `preview()` doesn't settle/persist) — confirm it passes.

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: compiles with no type errors.

- [ ] **Step 3: Commit (only if build produced tracked changes; otherwise skip)**

```bash
git status --porcelain
# if clean, nothing to commit — the feature is complete
```

## Self-Review notes

- **Spec coverage:** DefiLlama chain TVL + momentum (Task 1) ✓; whitelist + parser + verdict prompt with loser's-strength + no-invention rules (Task 2) ✓; ModeDef id 4 via `runModeB` overrides + preview + registry (Task 3) ✓; soft-fail on both-null TVL (Task 1 `summarizeChainTvl` → null, Task 2 prompt qualitative branch, Task 3 continues) ✓; no route/body change — chains in `topic` (Task 3) ✓; client dropdown from the same whitelist (Task 5) ✓; settle-gates-delivery preserved (overrides only) ✓; analytics mode 4 (Task 4) ✓.
- **Type consistency:** `ChainTvl`, `fetchChainTvl`, `summarizeChainTvl`, `ChainEntry`, `parseChains`, `serperQueryFor`, `buildComparisonPrompt`, `ChainComparisonSubmitPayload` are named identically across producing and consuming tasks. `mode: 4` flows through `PreviewArgs` (Task 4) and `isValidMode` (Task 4) before the client emits it (Task 5).
- **Out of scope (unchanged):** per-chain Serper, CoinGecko native token, stablecoin-per-chain, token-vs-token, free-text chain entry.
