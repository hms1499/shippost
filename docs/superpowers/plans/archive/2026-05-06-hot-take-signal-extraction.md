# Hot Take prompt — signal-extraction body + angle close — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the Mode B (Hot Take) prompt so the body of the thread extracts signals neutrally and only the closing tweet expresses the user-chosen angle (asymmetric: verdict for bull/bear, evidence-test for skeptical).

**Architecture:** Single-file change to `lib/prompts/modeB.ts`. Rewrite three string blocks (`STRUCTURE`, `ANGLE_BRIEF`, `FEW_SHOT_EXAMPLE`) and keep `buildModeBPrompt`'s composition + signature intact. Lock the new shape with a Vitest unit test that asserts on the rendered prompt for each angle.

**Tech Stack:** TypeScript, Vitest 4 (already wired via `pnpm test:lib`), Groq `llama-3.3-70b-versatile` consumes the rendered prompt.

**Spec:** `docs/superpowers/specs/2026-05-06-hot-take-signal-extraction-design.md`

---

## File Structure

- **Modify:** `lib/prompts/modeB.ts` — replace `STRUCTURE`, `ANGLE_BRIEF`, `FEW_SHOT_EXAMPLE` constants. Keep public exports (`Angle`, `buildModeBPrompt`, `summarizeSerper`, `summarizeMarket`) unchanged.
- **Create:** `lib/prompts/modeB.test.ts` — colocated Vitest file. Locks the new prompt shape so future edits can't silently regress to thread-wide angle.

No other files touched. No schema, route, hook, or component changes.

---

## Task 1: Write failing tests for the new prompt shape

**Files:**
- Create: `lib/prompts/modeB.test.ts`

- [ ] **Step 1: Create the test file**

Create `lib/prompts/modeB.test.ts` with the full content below.

```typescript
import { describe, it, expect } from 'vitest';
import { buildModeBPrompt } from './modeB';

const baseInput = {
  eventDescription: 'Vitalik posted a draft EIP for encrypted mempools.',
  searchSummary: '- Draft EIP discusses commit-reveal mempool scheme.',
  marketSnippet: 'ETH @ $3120, +1.4% 24h',
};

describe('buildModeBPrompt — body structure (angle-agnostic)', () => {
  it('instructs neutral signal extraction in body tweets', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    // Body must surface signals (facts / light implications) without verdict adjectives.
    expect(out).toMatch(/signal/i);
    expect(out).toMatch(/no directional adjectives/i);
  });

  it('caps thread length to the existing 4–10 floor/ceiling', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'skeptical' });
    expect(out).toMatch(/Never fewer than 4/);
    expect(out).toMatch(/Never more than 10/);
  });

  it('reminds the model to cite only facts in context', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bearish' });
    expect(out).toMatch(/Never invent|only use facts/i);
  });

  it('passes the user description and search/market context through', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    expect(out).toContain(baseInput.eventDescription);
    expect(out).toContain('commit-reveal mempool scheme');
    expect(out).toContain('ETH @ $3120');
  });
});

describe('buildModeBPrompt — angle-specific close', () => {
  it('bullish close instructs a 1-line net-bullish verdict', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    expect(out).toMatch(/net bullish/i);
    expect(out).toMatch(/no hedging/i);
  });

  it('bearish close instructs a 1-line net-bearish verdict', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bearish' });
    expect(out).toMatch(/net bearish/i);
    expect(out).toMatch(/no hedging/i);
  });

  it('skeptical close instructs a concrete evidence-test, not a verdict', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'skeptical' });
    expect(out).toMatch(/what would change my mind|evidence/i);
    expect(out).toMatch(/falsifiable|specific|concrete/i);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
pnpm test:lib
```

Expected: the new `modeB.test.ts` file fails on every `it(...)` because the current `modeB.ts` strings do not contain the new keywords (`signal`, `no directional adjectives`, `net bullish`, `what would change my mind`, etc.).

The pre-existing `threadParser.test.ts` should still pass (5/5).

- [ ] **Step 3: Commit the failing test**

```bash
git add lib/prompts/modeB.test.ts
git commit -m "test(modeB): lock new prompt shape — body neutrality + asymmetric angle close"
```

---

## Task 2: Rewrite `STRUCTURE`, `ANGLE_BRIEF`, `FEW_SHOT_EXAMPLE`

**Files:**
- Modify: `lib/prompts/modeB.ts`

- [ ] **Step 1: Replace the three string constants and `buildModeBPrompt` body**

Open `lib/prompts/modeB.ts`. The file currently exports `ANGLE_BRIEF`, `STRUCTURE`, `LENGTH_GUIDANCE`, `FEW_SHOT_EXAMPLE`, and the `buildModeBPrompt` function. Keep `LENGTH_GUIDANCE`, `summarizeSerper`, `summarizeMarket`, the `Angle` type, and the function signatures untouched. Replace `ANGLE_BRIEF`, `STRUCTURE`, `FEW_SHOT_EXAMPLE` with the versions below, and update `buildModeBPrompt` to compose them in the new order.

The full new content for the file:

```typescript
import type { SerperOrganicResult } from '@/lib/pipeline/serperStep';

export type Angle = 'bullish' | 'bearish' | 'skeptical';

interface ModeBInput {
  eventDescription: string;
  angle: Angle;
  searchSummary: string | null;
  marketSnippet: string | null;
}

const ANGLE_BRIEF: Record<Angle, string> = {
  bullish:
    'Closing tweet rule (T(n)): one short verdict line in the form "net bullish on <event> because <signal>." Pick the single signal already on the table that, on net, supports a long-side position. No hedging, no DYOR, no "but". One sentence.',
  bearish:
    'Closing tweet rule (T(n)): one short verdict line in the form "net bearish on <event> because <signal>." Pick the single signal already on the table that, on net, supports a short-side position. No hedging, no DYOR, no "but". One sentence.',
  skeptical:
    'Closing tweet rule (T(n)): one evidence-test line in the form "what would change my mind: <observable signal>." The signal must be concrete, falsifiable, and specific — a number above/below a threshold, a named protocol shipping by a named date, a contract reaching a TVL level. No verdict, no fence-sitting prose, no "we will see". One sentence.',
};

const STRUCTURE = `Structure (signal-extraction body, angle only at the close):
- T1: hook framing the event in plain terms. No question opener. No "in this thread". No angle adjectives.
- T2: anchor signal — the single most verifiable fact about this event, drawn directly from the user description, search context, or market data.
- T3 ... T(n-1): additional signals. Each tweet does ONE of:
    (a) present a hard fact (named entity, number, date, contract, EIP, protocol)
    (b) draw a single light implication from a signal already on the table ("3 client teams committed → adoption pressure on the rest")
  No directional adjectives. Body must read as a neutral exposition of what is known, not a take.
- T(n): the only angle-specific tweet. Follow the closing rule for the chosen angle (see ANGLE).

Constraints:
- Only use facts that appear in the provided description, search context, or market context, or that are universally known. Never invent prices, dates, names, contracts, or numbers.
- Stay on the single event the user named. Do not drift into adjacent stories.
- Body tweets do not declare a side. Save the verdict / evidence-test for T(n).`;

const LENGTH_GUIDANCE = `Length: use as many tweets as the event needs to be argued well. Typical range is 5–9 tweets. Never fewer than 4. Never more than 10. Stop the moment the closing rule is satisfied; do not pad.`;

const FEW_SHOT_EXAMPLE = `Reference for voice and shape (different event — match the structure, do NOT copy content):

Sample event: Dencun upgrade activated on Ethereum mainnet, March 13 2024.
Sample search context:
- Dencun activated on Ethereum mainnet on March 13, 2024.
- EIP-4844 introduced "blob-carrying transactions" with a separate fee market.
- L2 user fees on Arbitrum, Optimism, and Base fell roughly 10x post-activation.
- Blob fee target is 3 blobs/block, max 6.
Sample market data: (none)
Sample angle: skeptical

<example_thread>
1/ Dencun activated on Ethereum mainnet on March 13, 2024 and changed how L2s post data to L1.

2/ Pre-Dencun, L2s settled calldata at the same gas market as everyone else. EIP-4844 introduced a separate blob fee market, target 3 blobs per block, max 6.

3/ In the days after activation, L2 user fees on Arbitrum, Optimism, and Base fell roughly 10x. Throughput limits on those L2s now scale with blob supply, not L1 calldata gas.

4/ Blob base fees have hovered near zero since launch — supply has run ahead of demand. The cost L2s pay for L1 data is currently not a meaningful ETH burn input.

5/ What would change my mind: a sustained stretch of more than two weeks where blob base fees stay non-zero and L2 throughput keeps climbing.
</example_thread>`;

export function buildModeBPrompt(input: ModeBInput): string {
  const blocks = [
    FEW_SHOT_EXAMPLE,
    `Now write a thread on:`,
    `Event: ${input.eventDescription.trim()}`,
    `Angle: ${input.angle}. ${ANGLE_BRIEF[input.angle]}`,
  ];

  if (input.searchSummary) {
    blocks.push(
      `Search context (use as ground truth — facts you cite must come from here):\n${input.searchSummary}`,
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

export function summarizeSerper(
  organic: SerperOrganicResult[],
  newsSnippet: string | null,
): string {
  const lines: string[] = [];
  if (newsSnippet) lines.push(`Top answer: ${newsSnippet}`);
  for (const r of organic.slice(0, 5)) {
    const when = r.date ? ` (${r.date})` : '';
    lines.push(`- ${r.title}${when}: ${r.snippet}`);
  }
  return lines.join('\n');
}

export function summarizeMarket(cg: {
  symbol: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  marketCapUsd: number | null;
}): string | null {
  if (!cg.symbol || cg.priceUsd === null) return null;
  const parts: string[] = [`${cg.symbol} @ $${cg.priceUsd.toPrecision(4)}`];
  if (cg.change24hPct !== null) parts.push(`${cg.change24hPct.toFixed(2)}% 24h`);
  if (cg.marketCapUsd) parts.push(`mcap ~$${(cg.marketCapUsd / 1e6).toFixed(1)}M`);
  return parts.join(', ');
}
```

- [ ] **Step 2: Run the unit tests, confirm they pass**

```bash
pnpm test:lib
```

Expected:
- `lib/prompts/modeB.test.ts` — 7 passing
- `lib/threadParser.test.ts` — 5 passing
- Total: 12 passing, 0 failing

If any `modeB.test.ts` assertion fails, re-read the assertion's regex against the new strings above and edit the prompt wording — never edit the test to match a buggy prompt.

- [ ] **Step 3: Run the type-checker**

```bash
pnpm exec tsc --noEmit
```

Expected: no output, exit code 0. (`buildModeBPrompt`'s signature is unchanged, so callers in `lib/pipeline/runModeB.ts` still type-check.)

- [ ] **Step 4: Run the production build**

```bash
pnpm build
```

Expected: build succeeds. The `/` route bundle should remain at ~217 kB First Load JS (the prompt strings live server-side, not in the client bundle).

- [ ] **Step 5: Commit the rewrite**

```bash
git add lib/prompts/modeB.ts
git commit -m "feat(prompts/modeB): signal-extraction body + asymmetric angle close

- STRUCTURE rewrites body as neutral signal exposition; angle only at T(n)
- ANGLE_BRIEF becomes a per-angle CLOSE rule:
  - bullish/bearish: 1-line net verdict, no hedging
  - skeptical: 1-line concrete evidence-test, no fake-balance prose
- FEW_SHOT_EXAMPLE updated to match the new shape
- Public exports (Angle, buildModeBPrompt, summarizeSerper, summarizeMarket)
  unchanged — runModeB pipeline is contract-compatible

Spec: docs/superpowers/specs/2026-05-06-hot-take-signal-extraction-design.md"
```

---

## Task 3: Manual smoke (one thread per angle)

**Files:** none — runtime check only.

This task is the spec's acceptance gate. Skip only if you cannot run the local server (e.g. no `GROQ_API_KEY` available).

- [ ] **Step 1: Boot the dev server**

```bash
pnpm dev
```

Wait for `http://localhost:3000` to be reachable.

- [ ] **Step 2: Pay → Hot Take, three runs on the same event**

In the MiniPay-like flow on `/`, pick **🔥 Hot Take**, paste the same description for all three runs (e.g. *"Vitalik posted a draft EIP describing encrypted mempools — three client teams have signalled support, mainnet target is Q3."*), and run once per angle (`bullish`, `bearish`, `skeptical`).

For each result, verify on `/` (preview screen):

- 5–9 tweets total
- T1 frames the event without angle adjectives
- T2 surfaces a concrete fact from the description
- T3 → T(n-1) contain only facts or light implications. None of these tweets contain words from `system.ts`'s banned-words list (`massive`, `huge`, `incredible`, `revolutionize`, etc.) and none read as a take.
- T(n) matches the chosen angle:
  - `bullish` → starts with or contains "net bullish on" (or equivalent — the rule says verdict shape, not literal substring)
  - `bearish` → "net bearish on"
  - `skeptical` → "what would change my mind" or equivalent evidence-test framing, with a concrete falsifiable signal

If a body tweet contains a banned adjective or premature verdict, the prompt rule "No directional adjectives" was not enforced — record the failing output in `docs/bug-bash.md` under a `## Mode B prompt smoke (2026-05-06)` heading and tighten the STRUCTURE wording before shipping.

- [ ] **Step 3: Commit smoke notes (only if you logged anything)**

```bash
git add docs/bug-bash.md
git commit -m "docs(bug-bash): Mode B prompt smoke results — 2026-05-06"
```

If all three angles produced clean output, no commit is needed for this task.

---

## Definition of done

- [ ] Spec requirements (`docs/superpowers/specs/2026-05-06-hot-take-signal-extraction-design.md`) all map to a committed task above.
- [ ] `pnpm test:lib` passes (12/12 — 5 threadParser + 7 modeB).
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm build` clean; `/` bundle ≤ 217 kB First Load JS (no regression).
- [ ] Manual smoke run produced one thread per angle whose body is neutral and whose closing tweet matches the angle's rule (or smoke deferred with a recorded reason in `docs/bug-bash.md`).
