# Hook Engine + Banned-phrase Highlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let all four modes open with strong engagement hooks without reopening the AI-slop ban list, surface leaked banned phrases as a live inline highlight in the thread editor, and drop the 270-character cap end to end.

**Architecture:** A new pure module `lib/bannedPhrases.ts` becomes the single source of truth for the ban list — `system.ts` renders it into the prompt, and `ThreadPreview.tsx` uses its `detectBannedPhrases` to highlight matches live as the creator edits. Prompt changes are string-only (no pipeline/route/payment change). The 270 cap is deleted from both the prompt and the editor UI.

**Tech Stack:** TypeScript, Next.js 14 App Router, React 18, Vitest 4 (Node env only — no React component testing infra), Groq (llama-3.3-70b-versatile), pnpm.

## Global Constraints

- **Ban list stays verbatim.** No word is added to or removed from what counts as banned. Hooks are loosened at the level of opener *structure* only. (Spec: Part 1.)
- **No char clamp; tweets may be any length.** Remove every 270 reference from prompt + UI; do not reintroduce a limit. (Spec: Goals.)
- **Banned phrases are flag-only.** No auto-edit, no regeneration, no server round-trip. Detection is a pure client render-time computation. (Spec: Non-goals.)
- **Do not touch** `app/api/generate/stream/route.ts`, the pipeline (`lib/pipeline/*`), SSE event shapes, or payments. (Spec: Non-goals.)
- **No React component test infra exists** (no testing-library / jsdom / `.test.tsx`). UI tasks verify via `pnpm lint`, `pnpm build`, and manual check — never fabricate a component unit test.
- **Commits go directly to `main`** (trunk-based, one commit per task). No branches/PRs unless asked.

---

### Task 1: `lib/bannedPhrases.ts` — ban-list data + detection

**Files:**
- Create: `lib/bannedPhrases.ts`
- Test: `lib/bannedPhrases.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type BannedGroup = 'slop-opener' | 'marketing' | 'hype-adjective' | 'cta-filler'`
  - `interface Match { start: number; end: number; phrase: string; group: BannedGroup }`
  - `const BANNED_PHRASES: { group: BannedGroup; phrases: string[] }[]`
  - `function detectBannedPhrases(text: string): Match[]` — `end` is exclusive (`start + matchLength`); results sorted ascending by `start`; word-boundary + case-insensitive.
  - `function phraseList(group: BannedGroup): string` — the group's phrases, each wrapped in double quotes, joined by `, ` (e.g. `"massive", "huge"`).

- [ ] **Step 1: Write the failing test**

Create `lib/bannedPhrases.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { detectBannedPhrases, phraseList, BANNED_PHRASES } from './bannedPhrases';

describe('detectBannedPhrases', () => {
  it('flags a single banned word with an exclusive end span', () => {
    const m = detectBannedPhrases('we delve here');
    expect(m).toEqual([{ start: 3, end: 8, phrase: 'delve', group: 'slop-opener' }]);
  });

  it('is case-insensitive', () => {
    expect(detectBannedPhrases('DELVE').length).toBe(1);
  });

  it('respects word boundaries (no substring matches)', () => {
    expect(detectBannedPhrases('the delver arrived')).toEqual([]);
    expect(detectBannedPhrases('programming is fun')).toEqual([]); // must not match "GM"
  });

  it('matches multi-word phrases', () => {
    const m = detectBannedPhrases('unlock the power of X');
    expect(m).toEqual([
      { start: 0, end: 16, phrase: 'unlock the power', group: 'marketing' },
    ]);
  });

  it('returns multiple matches sorted by start', () => {
    const m = detectBannedPhrases('a massive, powerful thing');
    expect(m.map((x) => x.phrase)).toEqual(['massive', 'powerful']);
    expect(m.map((x) => x.group)).toEqual(['hype-adjective', 'hype-adjective']);
  });

  it('returns [] for clean crypto/dev text', () => {
    expect(detectBannedPhrases('gas dropped from 40 to 12 gwei')).toEqual([]);
  });
});

describe('phraseList', () => {
  it('quotes and comma-joins a group', () => {
    expect(phraseList('cta-filler')).toBe('"DYOR", "WAGMI", "GM", "ngmi", "anon"');
  });

  it('covers every banned phrase from the original prompt', () => {
    const all = BANNED_PHRASES.flatMap((e) => e.phrases);
    for (const p of ['delve', 'leverage', 'massive', 'game changer', 'DYOR']) {
      expect(all).toContain(p);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:lib -- bannedPhrases`
Expected: FAIL — `Cannot find module './bannedPhrases'`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/bannedPhrases.ts`. The phrases are lifted verbatim from `lib/prompts/system.ts:10-16`; line 10's mixed bag is split into `slop-opener` (openers/verbs) and `marketing` (landing-page phrases).

```ts
// Single source of truth for the anti-slop ban list. Consumed by
// lib/prompts/system.ts (rendered into the prompt) and by ThreadPreview
// (live inline highlighting). No 'use client' / server-only imports — this
// module is safe on both sides of the boundary.

export type BannedGroup = 'slop-opener' | 'marketing' | 'hype-adjective' | 'cta-filler';

export interface Match {
  start: number;
  end: number; // exclusive
  phrase: string;
  group: BannedGroup;
}

export const BANNED_PHRASES: { group: BannedGroup; phrases: string[] }[] = [
  {
    group: 'slop-opener',
    phrases: [
      "let's dive in", 'in this thread', 'buckle up', 'imagine', 'ever wondered',
      "let's explore", 'delve', 'leverage', 'harness', 'navigate', 'embark',
      'journey', 'tap into',
    ],
  },
  {
    group: 'marketing',
    phrases: ['the world of', 'game changer', 'revolutionize', 'unlock the power'],
  },
  {
    group: 'hype-adjective',
    phrases: [
      'massive', 'huge', 'incredible', 'exciting', 'fascinating', 'powerful',
      'seamless', 'robust', 'cutting-edge',
    ],
  },
  {
    group: 'cta-filler',
    phrases: ['DYOR', 'WAGMI', 'GM', 'ngmi', 'anon'],
  },
];

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// One global, case-insensitive, word-bounded matcher per phrase, built once.
// Every phrase starts and ends with a word character, so \b...\b is valid.
const MATCHERS: { group: BannedGroup; phrase: string; re: RegExp }[] =
  BANNED_PHRASES.flatMap((entry) =>
    entry.phrases.map((phrase) => ({
      group: entry.group,
      phrase,
      re: new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi'),
    })),
  );

export function detectBannedPhrases(text: string): Match[] {
  const matches: Match[] = [];
  for (const { group, phrase, re } of MATCHERS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push({ start: m.index, end: m.index + m[0].length, phrase, group });
    }
  }
  return matches.sort((a, b) => a.start - b.start);
}

export function phraseList(group: BannedGroup): string {
  return BANNED_PHRASES.filter((e) => e.group === group)
    .flatMap((e) => e.phrases)
    .map((p) => `"${p}"`)
    .join(', ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:lib -- bannedPhrases`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/bannedPhrases.ts lib/bannedPhrases.test.ts
git commit -m "$(cat <<'EOF'
feat(prompts): single-source ban list with detectBannedPhrases

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `system.ts` — source ban list, add HOOK block, drop 270

**Files:**
- Modify: `lib/prompts/system.ts`
- Test: `lib/prompts/system.test.ts` (create)

**Interfaces:**
- Consumes: `phraseList` from `lib/bannedPhrases` (Task 1).
- Produces: `SYSTEM_PROMPT` (unchanged export name/type: `string`).

- [ ] **Step 1: Write the failing test**

Create `lib/prompts/system.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from './system';

describe('SYSTEM_PROMPT', () => {
  it('adds a HOOK block that permits a strong tweet-1 opener', () => {
    expect(SYSTEM_PROMPT).toMatch(/HOOK/);
    expect(SYSTEM_PROMPT).toMatch(/tweet 1/i);
    expect(SYSTEM_PROMPT).toMatch(/carry a fact/i);
  });

  it('drops the 270-character cap', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/270/);
  });

  it('still bans the slop phrases (sourced from bannedPhrases)', () => {
    expect(SYSTEM_PROMPT).toContain('"delve"');
    expect(SYSTEM_PROMPT).toContain('"massive"');
    expect(SYSTEM_PROMPT).toContain('"DYOR"');
  });

  it('keeps the em-dash and no-preamble rules', () => {
    expect(SYSTEM_PROMPT).toMatch(/Em-dash/);
    expect(SYSTEM_PROMPT).toMatch(/Output only the numbered tweets/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test:lib -- prompts/system`
Expected: FAIL — HOOK assertions fail and `270` still present.

- [ ] **Step 3: Rewrite `system.ts`**

Replace the whole file with (note: `imagine` etc. remain banned; only opener *structure* is loosened via the new HOOK block):

```ts
import { phraseList } from '@/lib/bannedPhrases';

export const SYSTEM_PROMPT = `You are ShipPost, writing X (Twitter) threads for crypto builders and developers.

VOICE
- Sound like a senior engineer thinking out loud, not a marketer or a textbook.
- One claim per tweet. Specific, falsifiable, concrete.
- Show with numbers, addresses, function names, gas figures. Cut vague hype.
- Confident. No throat-clearing, no apologies, no "let me explain".

HOOK (tweet 1 only)
- Open with a line that makes scrolling stop: a hard number, a contradiction or tension, a stake, or a specific question the reader cannot yet answer.
- The hook must CARRY a fact, never merely tease one. Good: "Blobs were supposed to make L2s cheap. Fees fell 10x, then blob revenue went to zero." Bad: "Let's talk about what blobs really mean."
- A question is allowed only if it is specific and unanswered ("Why does UNI still route $0 to holders?"), never a rhetorical throat-clear ("ever wondered about tokens?").
- Every banned phrase below still applies. Make the hook land through structure, not through hype words.

DO NOT WRITE
- These phrases (auto-fail if any appear): ${phraseList('slop-opener')}, ${phraseList('marketing')}.
- Hyped adjectives: ${phraseList('hype-adjective')}.
- Em-dash sentence joins like "X — and that's why Y". Use a period or a new tweet.
- Hashtags. Emojis. Markdown formatting. Bullets inside a tweet.
- Titles, preambles, wrapper text. No "Here is the thread:" line. No sign-off.
- Crypto-Twitter filler: ${phraseList('cta-filler')}.

FORMAT
- Number every tweet from "1/" through "N/", one per line.
- Separate tweets by exactly one blank line.
- Output only the numbered tweets. Nothing before, nothing after.

FACTS
- Never invent prices, dates, TVL, gas numbers, EIP numbers, function signatures, or proper names.
- If a specific number or name is uncertain, drop it and stay vague. Vague is fine. Wrong is not.`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test:lib -- prompts/system`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/prompts/system.ts lib/prompts/system.test.ts
git commit -m "$(cat <<'EOF'
feat(prompts): add HOOK block, drop 270 cap, source ban list

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Mode files — loosen the tweet-1 hook instruction

**Files:**
- Modify: `lib/prompts/modeA.ts:23`
- Modify: `lib/prompts/modeB.ts:23`
- Modify: `lib/prompts/tokenAnalysis.ts:34`
- Modify: `lib/prompts/dailyRecap.ts:44`
- Test: `lib/prompts/modeA.test.ts` (create), and extend `modeB.test.ts`, `tokenAnalysis.test.ts`, `dailyRecap.test.ts`

**Interfaces:**
- Consumes: nothing new (prose-only edits inside existing builders).
- Produces: builder signatures unchanged.

- [ ] **Step 1: Write/extend the failing tests**

Create `lib/prompts/modeA.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildModeAPrompt } from './modeA';

describe('buildModeAPrompt — hook', () => {
  it('invites a hook on tweet 1 and no longer bans question openers', () => {
    const out = buildModeAPrompt({ topic: 'reentrancy guards', audience: 'intermediate', searchSummary: null });
    expect(out).toMatch(/hook/i);
    expect(out).not.toMatch(/No question opener/i);
  });
});
```

Append to `lib/prompts/modeB.test.ts` (inside the top-level, after the existing describe blocks):

```ts
describe('buildModeBPrompt — hook', () => {
  it('invites a hook and drops the question-opener ban, keeps neutral body', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    expect(out).toMatch(/hook/i);
    expect(out).not.toMatch(/No question opener/i);
    expect(out).toMatch(/No angle adjectives/i);
  });
});
```

Append to `lib/prompts/tokenAnalysis.test.ts`:

```ts
describe('buildTokenAnalysisPrompt — hook', () => {
  it('invites a hook and drops the question-opener ban', () => {
    const out = buildTokenAnalysisPrompt({ ticker: '$CELO', angle: 'skeptical', searchSummary: null, marketSnippet: null });
    expect(out).toMatch(/hook/i);
    expect(out).not.toMatch(/No question opener/i);
  });
});
```

Append to `lib/prompts/dailyRecap.test.ts`:

```ts
describe('buildDailyRecapPrompt — hook', () => {
  it('allows a neutral question opener but keeps event-not-mood', () => {
    const out = buildDailyRecapPrompt({ searchSummary: null, marketSnippet: null });
    expect(out).toMatch(/neutral question is allowed/i);
    expect(out).toMatch(/name the event, not a mood/i);
  });
});
```

> If `tokenAnalysis.test.ts` / `dailyRecap.test.ts` don't already import their builder at the top, add the import. Confirm the exact builder arg shape against the file before running (`buildTokenAnalysisPrompt` and `buildDailyRecapPrompt` signatures are in their source).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:lib -- prompts`
Expected: FAIL — new hook assertions fail (files still say "No question opener").

- [ ] **Step 3: Apply the four edits**

`lib/prompts/modeA.ts` — replace line 23:

Old:
```
- Tweet 1: open with a one-line frame of the concept. Plain, specific. No question opener, no "in this thread", no preamble.
```
New:
```
- Tweet 1: lead with a hook (see HOOK) — a hard specific about the concept, or a real question the reader cannot yet answer. Anchor it to something concrete. No "in this thread", no preamble.
```

`lib/prompts/modeB.ts` — replace line 23:

Old:
```
- T1: hook framing the event in plain terms. No question opener. No "in this thread". No angle adjectives.
```
New:
```
- T1: hook (see HOOK) — frame the event through its single sharpest verifiable fact or tension. A specific question is allowed. No "in this thread". No angle adjectives.
```

`lib/prompts/tokenAnalysis.ts` — replace line 34:

Old:
```
- T1: hook — name the token in plain terms (what it is / what it does), anchored to one fact from the market data (price or market cap). No question opener. No "in this thread". No angle adjectives.
```
New:
```
- T1: hook (see HOOK) — name the token (what it is / what it does) through its most striking real number or contradiction, anchored to the market data. A specific question is allowed. No "in this thread". No angle adjectives.
```

`lib/prompts/dailyRecap.ts` — replace line 44:

Old:
```
Never start with: GM, Good morning, Today, In this thread, or a question.
```
New:
```
Never start with: GM, Good morning, Today, or In this thread. A sharp, neutral question is allowed as an opener ("Why did BTC slide 4% while SOL ran 5%?"). Still name the event, not a mood.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:lib -- prompts`
Expected: PASS (all prompt suites, including the new hook cases).

- [ ] **Step 5: Commit**

```bash
git add lib/prompts/modeA.ts lib/prompts/modeB.ts lib/prompts/tokenAnalysis.ts lib/prompts/dailyRecap.ts lib/prompts/modeA.test.ts lib/prompts/modeB.test.ts lib/prompts/tokenAnalysis.test.ts lib/prompts/dailyRecap.test.ts
git commit -m "$(cat <<'EOF'
feat(prompts): enable tweet-1 hooks across all four modes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `ThreadPreview.tsx` — live highlight, remove 270 UI

**Files:**
- Modify: `components/ThreadPreview.tsx`

**Interfaces:**
- Consumes: `detectBannedPhrases` from `lib/bannedPhrases` (Task 1).
- Produces: `ThreadPreview` — same public props (`{ tweets: string[]; onChange }`).

No component-test infra exists, so this task is verified by typecheck + lint + manual. The detection logic it renders is already unit-tested in Task 1.

- [ ] **Step 1: Add the import and a `HighlightedText` renderer**

At the top of `components/ThreadPreview.tsx`, add to the imports:

```tsx
import { useState, useMemo } from 'react';
import { detectBannedPhrases } from '@/lib/bannedPhrases';
```
(The file already imports `useState` from `'react'` — merge `useMemo` into that line rather than duplicating.)

Add this component near the bottom of the file (beside `LeafNib`):

```tsx
/**
 * Renders tweet text with banned phrases wrapped in a wavy-underline <mark>.
 * Detection is live: it recomputes on every text change so a phrase the creator
 * deletes stops being flagged immediately.
 */
function HighlightedText({ text }: { text: string }) {
  const matches = useMemo(() => detectBannedPhrases(text), [text]);
  if (matches.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start < cursor) return; // overlapping match already inside a mark
    if (m.start > cursor) parts.push(text.slice(cursor, m.start));
    parts.push(
      <mark
        key={i}
        title={`${m.group.replace('-', ' ')} — cut or replace`}
        className="bg-transparent underline decoration-wavy underline-offset-2 decoration-[hsl(var(--vermillion))] text-[hsl(var(--vermillion))]"
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
```

- [ ] **Step 2: Use it in the leaf body**

In `FolioLeaf`, replace the non-editing body paragraph:

Old:
```tsx
<p
  className={
    'text-sm leading-relaxed whitespace-pre-wrap ' +
    (isFirst ? 'drop-cap' : '')
  }
>
  {text}
</p>
```
New:
```tsx
<p
  className={
    'text-sm leading-relaxed whitespace-pre-wrap ' +
    (isFirst ? 'drop-cap' : '')
  }
>
  <HighlightedText text={text} />
</p>
```

- [ ] **Step 3: Delete all 270 / ink-meter UI**

Make these removals in `components/ThreadPreview.tsx`:

1. Delete the constant: `const MAX_TWEET_LEN = 270;` (line 12).
2. In the `tweets.map(...)` block, delete the three computed lines and the props that fed the meter:
   - remove `const len = text.length;`, `const over = len > MAX_TWEET_LEN;`, `const ratio = len / MAX_TWEET_LEN;`
   - remove `len={len} ratio={ratio} over={over}` from the `<FolioLeaf ... />` props.
   - `const text = isEditing ? draft : tw;` stays only if still used; it is not needed after this — pass `text={tw}` to the leaf as before and drop the `text`/`len` locals. Keep `isEditing` and `key`.
3. In `LeafProps`, delete `len: number; ratio: number; over: boolean;`.
4. In the `FolioLeaf({ ... })` destructure, delete `len, ratio, over`.
5. Replace the footer block (the `<div className="flex items-center gap-3 mt-1">` that held `<InkMeter />`, the `{len}/{MAX_TWEET_LEN}` span, and the edit buttons) with an editing-only action row:

```tsx
{isEditing && (
  <div className="flex items-center gap-2 mt-1 justify-end">
    <Button size="sm" variant="ghost" onClick={onCancel}>
      Cancel
    </Button>
    <Button size="sm" onClick={onSave} disabled={draft.trim().length === 0}>
      Save
    </Button>
  </div>
)}
```

6. Delete the over-limit warning block:
```tsx
{!isEditing && over && (
  <p className="text-xs text-[hsl(var(--vermillion))] leading-snug">
    X will split this leaf into multiple tweets when posted.
  </p>
)}
```

7. Delete the entire `InkMeter` function component (the `function InkMeter({ ratio, over }) { ... }` block at the bottom).

- [ ] **Step 4: Verify typecheck + lint pass**

Run: `pnpm lint && pnpm build`
Expected: no errors; in particular no "unused variable" (`len`/`ratio`/`over`/`InkMeter`/`MAX_TWEET_LEN`) and no "cannot find name" errors. If lint flags an unused import (e.g. a now-unused icon), remove it.

- [ ] **Step 5: Manual verification**

Run: `pnpm dev`, generate or open a thread, then in the editor:
- Type a banned word (e.g. "massive") into a tweet → it renders with a wavy vermillion underline; hovering shows "hype adjective — cut or replace".
- Delete the word → the highlight disappears immediately.
- Paste text longer than 270 chars → it renders in full with no counter, meter, or split warning.

Confirm each, then proceed.

- [ ] **Step 6: Commit**

```bash
git add components/ThreadPreview.tsx
git commit -m "$(cat <<'EOF'
feat(editor): live banned-phrase highlight, drop 270 char UI

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Final verification

- [ ] Run the full lib suite: `pnpm test:lib` — all green.
- [ ] Run `pnpm lint` and `pnpm build` — both clean.
- [ ] Grep confirms no stray cap: `grep -rn "270\|MAX_TWEET_LEN" lib app components` returns only `components/ui/card.tsx:25` (`rotate={270}`, unrelated).

## Self-review notes

- **Spec coverage:** Part 1 hooks → Tasks 2 (system HOOK + drop 270) & 3 (four modes). Part 2 highlight → Tasks 1 (`detectBannedPhrases`) & 4 (ThreadPreview). Single-source ban list → Task 1 + Task 2 `phraseList`. Drop-270 end to end → Task 2 (prompt) + Task 4 (UI). All spec sections mapped.
- **Type consistency:** `detectBannedPhrases`, `phraseList`, `BannedGroup`, `Match` are named identically in their definition (Task 1) and every consumer (Tasks 2, 4). `Match.end` is exclusive everywhere.
- **No placeholders:** every code step shows the exact code; every run step shows the exact command and expected result.
