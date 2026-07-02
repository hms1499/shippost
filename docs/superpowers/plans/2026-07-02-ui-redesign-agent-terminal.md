# Agent Terminal UI Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the codex/parchment aesthetic with a single dark "Agent Terminal" theme across the whole app, with a new mission-control `AgentTrace` hero screen that renders the x402 pipeline as a live trace.

**Architecture:** Token-level retheme (CSS variables + Tailwind config reskin the whole app on day 1), then screen-by-screen component swaps. Old codex aliases (`--ink-faded`, `font-display`, `heading-sub`) are kept pointing at terminal values during migration so un-migrated screens stay coherent; dead components are deleted last. Logic, flows, and API contracts are untouched.

**Tech Stack:** Next.js 14 App Router, Tailwind 3.4, framer-motion 12, lucide-react, next/font (JetBrains Mono + Inter), Vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-02-ui-redesign-agent-terminal-design.md`

## Global Constraints

- **Out of bounds:** `/api/generate`, `lib/pipeline/` (except reading `types.ts`), contracts, refund logic, `lib/usePayForThread`, `hooks/useThreadGeneration.ts`. UI may never render tweet text before the `step_output` event supplies it (settle gates delivery).
- **Mobile-first:** verify every screen at 360×740; MiniPay webview is the primary surface. No heavy blur/glow/backdrop-filter.
- Color conventions (app-wide invariants): green `--primary` = action/agent activity; amber `--money` = **every** $ amount; red `--destructive` = errors/refunds.
- Fonts: JetBrains Mono = all UI chrome/labels/data/logs; Inter = AI-generated tweet content **only**. IM Fell + EB Garamond are removed.
- Labels: UPPERCASE + `tracking-[0.16em]` via existing `.heading-sub` class (redefined, kept).
- Radius: default `--radius: 0.5rem`; panels 6–8px.
- On-chain mode ids in `ModePicker` (`educational`, `hot-take`, `token-analysis`, `daily-recap`) and their `ThreadRequested` mapping must not change; only presentation changes. (Spec says "2-button segment" — reality is 4 modes; keep 4. Spec deviation approved by this plan.)
- After every task: `pnpm test:lib` and `pnpm build` must pass. Each task ends in its own commit to `main` (trunk-based, per user preference).
- Existing accessibility affordances stay: `prefers-reduced-motion` block in globals.css, `aria-label`s on status icons, `useReducedMotion()` where already present.

## Verification commands

```bash
pnpm test:lib     # Vitest over lib/ and app/ — must pass after every task
pnpm build        # production build — must pass after every task
pnpm dev          # manual check at 360×740 (Chrome devtools → responsive)
```

---

### Task 1: Design tokens, fonts, single theme

Whole app reskins after this task. Old codex utility classes become aliases so un-migrated components still render coherently.

**Files:**
- Modify: `app/globals.css` (replace whole file)
- Modify: `tailwind.config.ts`
- Modify: `app/layout.tsx` (replace whole file)
- Delete: `components/ThemeApplicator.tsx`

**Interfaces:**
- Produces: CSS vars `--money`, terminal values for all shadcn tokens; Tailwind color `money`, `text-dim`; `font-sans` = Inter (tweet content), `font-mono` = JetBrains Mono, `font-display` aliased to mono (compat). `.heading-sub` unchanged in name. `--ink-faded`/`--ink-deep`/`--vermillion` kept as compat aliases.
- Consumes: nothing.

- [ ] **Step 1: Replace `app/globals.css` with the terminal token sheet**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  /* Agent Terminal — single dark theme. Phosphor-green console: near-black
     green-tinted ground, green = action/agent, amber = money, red = error.
     The `dark` class is hardcoded on <html> so legacy `dark:` variants keep
     resolving during migration; :root and .dark share one token set. */
  :root,
  .dark {
    --background: 120 13% 5%;        /* #0A0D0A */
    --foreground: 120 21% 93%;       /* #E8F0E8 */
    --card: 120 13% 8%;              /* #111611 */
    --card-foreground: 120 21% 93%;
    --primary: 134 92% 66%;          /* #59F87D */
    --primary-foreground: 140 60% 6%;
    --secondary: 120 13% 11%;
    --secondary-foreground: 120 21% 93%;
    --muted: 120 13% 11%;
    --muted-foreground: 120 8% 53%;  /* #7D8F7D */
    --accent: 111 24% 16%;           /* #22331F */
    --accent-foreground: 120 21% 93%;
    --destructive: 0 100% 68%;       /* #FF5C5C */
    --destructive-foreground: 0 0% 98%;
    --border: 111 24% 16%;
    --input: 111 24% 20%;
    --ring: 134 92% 66%;
    --radius: 0.5rem;

    /* Terminal extras */
    --money: 40 100% 64%;            /* #FFC247 — every $ amount */

    /* Compat aliases — codex names still referenced by un-migrated
       components. Deleted in Task 8. */
    --ink-deep: 120 21% 93%;
    --ink-faded: 120 8% 53%;
    --vermillion: 0 100% 68%;
  }
}

@layer base {
  * {
    @apply border-border;
  }

  /* Mono-first chrome. Inter (--font-sans) is reserved for AI-generated
     tweet content via the `font-sans` utility. */
  body {
    @apply bg-background text-foreground;
    font-family: var(--font-mono), ui-monospace, SFMono-Regular, monospace;
    font-size: 0.9375rem;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    /* CRT scanlines — approved texture. Repeating 3px gradient, ~0 perf cost. */
    background-image: repeating-linear-gradient(
      0deg,
      transparent 0px,
      transparent 2px,
      hsl(120 40% 2% / 0.35) 2px,
      hsl(120 40% 2% / 0.35) 3px
    );
  }

  h1, h2, h3 {
    font-family: var(--font-mono), ui-monospace, monospace;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  /* UPPERCASE tracked label — approved. Name kept from codex era so
     un-migrated call sites inherit the terminal look for free. */
  .heading-sub {
    font-family: var(--font-mono), ui-monospace, monospace;
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-weight: 600;
    color: hsl(var(--muted-foreground));
  }

  .font-mono, code, pre, kbd, samp {
    font-family: var(--font-mono), ui-monospace, monospace;
    font-variant-numeric: lining-nums tabular-nums;
  }

  .lucide {
    stroke-width: 1.75;
  }

  a:not(.no-underline) {
    text-decoration: underline;
    text-underline-offset: 0.22em;
    text-decoration-thickness: 1px;
    text-decoration-color: hsl(var(--primary) / 0.5);
  }
  a:hover:not(.no-underline) {
    text-decoration-color: hsl(var(--primary));
  }

  ::selection {
    background: hsl(var(--primary) / 0.3);
    color: hsl(var(--foreground));
  }

  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: hsl(var(--border));
    border-radius: 999px;
    border: 2px solid hsl(var(--background));
  }
  ::-webkit-scrollbar-thumb:hover {
    background: hsl(var(--muted-foreground));
  }
}

@layer components {
  /* Blinking block cursor — prompt inputs and live log tails. */
  @keyframes cursor-blink {
    0%, 49% { opacity: 1; }
    50%, 100% { opacity: 0; }
  }
  .cursor-block {
    display: inline-block;
    width: 0.55em;
    height: 1.1em;
    vertical-align: text-bottom;
    background: hsl(var(--primary));
    animation: cursor-blink 1.1s steps(1) infinite;
  }

  /* Compat shims for un-migrated call sites — flattened to plain panels.
     Deleted in Task 8 along with their last usages. */
  .codex-card {
    box-shadow: 0 0 0 1px hsl(var(--border));
  }
  .folio::before { content: none; }
  .drop-cap::first-letter { all: unset; }
  .ink-draw path, .ink-draw circle, .ink-draw rect, .ink-draw line, .ink-draw polyline {
    animation: none;
  }
}

/* Accessibility: honor the OS "reduce motion" setting (WCAG 2.3.3). */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

- [ ] **Step 2: Update `tailwind.config.ts`**

Replace the `colors` additions and `fontFamily` block (keep `darkMode`, `content`, `borderRadius` as they are):

```ts
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        money: 'hsl(var(--money))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
```

```ts
      fontFamily: {
        // Terminal: mono is the chrome; Inter (`font-sans`) is reserved for
        // AI-generated tweet content. `display` is a compat alias for
        // un-migrated codex call sites — removed in Task 8.
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
```

- [ ] **Step 3: Replace `app/layout.tsx`**

```tsx
import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Inter } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-mono',
  display: 'swap',
});

// Inter is reserved for AI-generated thread content (`font-sans`): chrome is
// machine (mono), the output is writing for humans (sans).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ShipPost — your agent writes, pays, ships',
  description: 'Pay $0.05, an on-chain agent pays AI services per call and ships your X thread.',
  other: {
    'talentapp:project_verification': 'a716144f6408810e3737c83cfc3fd4e663c78686f3bc89e2945c4bd0346a196c4e46cc35371bf8137e929a2a73f5e6024aab7c9bf90ec93a4d34b052ddf144a8',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Single dark theme — set statically; ThemeApplicator (runtime MiniPay
  // detection) is deleted.
  themeColor: '#0A0D0A',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // `dark` is hardcoded so legacy `dark:` utilities keep resolving during the
  // migration; Task 8 strips remaining `dark:` variants.
  return (
    <html lang="en" className={`dark ${mono.variable} ${inter.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

- [ ] **Step 4: Delete `components/ThemeApplicator.tsx`**

```bash
rm components/ThemeApplicator.tsx
grep -rn "ThemeApplicator" app components   # expect: no matches
```

- [ ] **Step 5: Verify**

```bash
pnpm test:lib   # expect: pass (tests don't assert visuals)
pnpm build      # expect: success, no missing-module errors
```

Manual: `pnpm dev`, 360×740 — every screen already dark terminal (fonts mono, green primary buttons). Codex ornaments still visible but recolored; that's expected until later tasks.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css tailwind.config.ts app/layout.tsx components/ThemeApplicator.tsx
git commit -m "feat(ui): Agent Terminal design tokens — single dark theme, mono-first type"
```

---

### Task 2: Terminal primitives (`RuleDivider`, `TraceNote`, `TerminalPanel`) + shadcn restyle

Drop-in replacements with prop-compatible signatures so later tasks are mechanical swaps.

**Files:**
- Create: `components/terminal/RuleDivider.tsx`
- Create: `components/terminal/TraceNote.tsx`
- Create: `components/terminal/TerminalPanel.tsx`
- Modify: `components/ui/button.tsx`
- Modify: `components/ui/card.tsx`

**Interfaces:**
- Produces:
  - `RuleDivider({ label?, className? }: { label?: string; className?: string })` — 1px rule, optional centered mono label. Same `className` contract as `InkDivider`.
  - `TraceNote({ side = 'right', children, className }: { side?: 'left' | 'right'; children: React.ReactNode; className?: string })` — prop-identical to `Marginalia`.
  - `TerminalPanel({ title, children, className }: { title?: string; children: React.ReactNode; className?: string })` — bordered surface panel with `── TITLE ──` header row.
- Consumes: Task 1 tokens (`money`, `--primary`, `.heading-sub`).

- [ ] **Step 1: Create `components/terminal/RuleDivider.tsx`**

```tsx
import * as React from 'react';

/** 1px terminal rule; optional centered uppercase mono label. */
export function RuleDivider({ label, className }: { label?: string; className?: string }) {
  if (!label) {
    return <div className={`h-px bg-border ${className ?? ''}`} aria-hidden />;
  }
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`} aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="heading-sub text-[10px]">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
```

- [ ] **Step 2: Create `components/terminal/TraceNote.tsx`**

```tsx
import * as React from 'react';

/**
 * Dim mono annotation — terminal replacement for Marginalia. Prop-identical
 * so call sites swap 1:1.
 */
export function TraceNote({
  side = 'right',
  children,
  className,
}: {
  side?: 'left' | 'right';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={
        'text-[11px] font-mono text-muted-foreground leading-snug ' +
        (side === 'right' ? 'text-right' : 'text-left') +
        ' ' +
        (className ?? '')
      }
    >
      <span className="text-primary/60 select-none">{side === 'left' ? '// ' : ''}</span>
      {children}
      <span className="text-primary/60 select-none">{side === 'right' ? ' //' : ''}</span>
    </aside>
  );
}
```

- [ ] **Step 3: Create `components/terminal/TerminalPanel.tsx`**

```tsx
import * as React from 'react';

/** Bordered surface panel with a `── TITLE ──` header row. */
export function TerminalPanel({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-border bg-card p-4 ${className ?? ''}`}
    >
      {title && (
        <div className="flex items-center gap-2 mb-3" aria-hidden>
          <span className="h-px w-4 bg-border" />
          <span className="heading-sub text-[10px]">{title}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {children}
    </section>
  );
}
```

- [ ] **Step 4: Restyle `components/ui/button.tsx`**

Read the file; replace the cva **base** string and the `default`/`outline`/`ghost` variant strings with (keep all other variants/sizes and the component shell unchanged):

- base: `inline-flex items-center justify-center whitespace-nowrap rounded-md font-mono font-bold uppercase tracking-wide text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50`
- `default`: `bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/75`
- `outline`: `border border-primary/40 bg-transparent text-primary hover:bg-primary/10`
- `ghost`: `text-muted-foreground hover:text-foreground hover:bg-secondary`

- [ ] **Step 5: Neutralize `ornament` in `components/ui/card.tsx`**

Read the file. Keep the `ornament` prop **accepted** (call sites still pass it until Tasks 4–7) but delete the ornament rendering branch (corner SVG/flourish markup) so it renders nothing. Card base classes become: `rounded-lg border border-border bg-card text-card-foreground`.

- [ ] **Step 6: Verify + commit**

```bash
pnpm test:lib && pnpm build   # expect: pass
git add components/terminal components/ui/button.tsx components/ui/card.tsx
git commit -m "feat(ui): terminal primitives (RuleDivider, TraceNote, TerminalPanel) + shadcn restyle"
```

---

### Task 3: `AgentTrace` hero (Mission Control)

The screen users watch 15–40s. Three layers: pipeline stepper (per-service cell + amount), log window, tweet slots (locked placeholders while GROQ runs — real text only ever arrives via `step_output` after settle, so the lock visual matches the backend invariant by construction).

**Files:**
- Create: `lib/traceLog.ts` (pure log-line derivation — unit-testable)
- Test: `lib/traceLog.test.ts`
- Create: `components/AgentTrace.tsx`
- Modify: `app/HomeClient.tsx:72-74` (dynamic import swap)

**Interfaces:**
- Consumes: `ThreadGenerationState`, `StepState` from `@/lib/threadGeneration`; `StepId` from `@/lib/pipeline/types`; `PayStatus` from `@/lib/usePayForThread`; `TerminalPanel` from Task 2.
- Produces:
  - `type TraceLine = { key: string; glyph: 'ok' | 'run' | 'fail' | 'info'; text: string; amount?: string; txHash?: string }`
  - `appendTraceLines(lines: TraceLine[], prev: ThreadGenerationState, next: ThreadGenerationState): TraceLine[]` — pure; appends lines for status transitions between two snapshots; idempotent per transition (keyed).
  - `AgentTrace(props)` — **exact same Props as `GeneratingStatus`** (`gen`, `payStatus?`, `payTxHash`, `threadId`, `chainExplorerBase`, `agentWalletAddress`) so the HomeClient swap is one line.

- [ ] **Step 1: Write the failing test `lib/traceLog.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { appendTraceLines, type TraceLine } from './traceLog';
import { initialState, applyEvent } from './threadGeneration';

describe('appendTraceLines', () => {
  it('emits a run line when a step starts', () => {
    const next = applyEvent(initialState, { type: 'step_started', step: 'serper' });
    const lines = appendTraceLines([], initialState, next);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ glyph: 'run', key: 'serper:running' });
    expect(lines[0].text).toContain('serper');
  });

  it('emits an ok line with amount and tx on settle', () => {
    const running = applyEvent(initialState, { type: 'step_started', step: 'serper' });
    const settled = applyEvent(running, {
      type: 'step_settled', step: 'serper', txHash: '0xabc' as `0x${string}`,
      costAmount: '0.010', tokenSymbol: 'cUSD',
    });
    const lines = appendTraceLines(
      appendTraceLines([], initialState, running), running, settled,
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      glyph: 'ok', key: 'serper:settled', amount: '$0.010', txHash: '0xabc',
    });
  });

  it('is idempotent — same transition twice adds nothing', () => {
    const next = applyEvent(initialState, { type: 'step_started', step: 'groq' });
    const once = appendTraceLines([], initialState, next);
    const twice = appendTraceLines(once, next, next);
    expect(twice).toHaveLength(1);
  });

  it('emits fail line with error text', () => {
    const running = applyEvent(initialState, { type: 'step_started', step: 'factCheck' });
    const failed = applyEvent(running, { type: 'step_failed', step: 'factCheck', error: 'timeout' });
    const lines = appendTraceLines([], running, failed);
    expect(lines[0]).toMatchObject({ glyph: 'fail', key: 'factCheck:failed' });
    expect(lines[0].text).toContain('timeout');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
pnpm test:lib -- traceLog
# Expected: FAIL — Cannot find module './traceLog'
```

- [ ] **Step 3: Implement `lib/traceLog.ts`**

```ts
// Pure derivation of terminal log lines from ThreadGenerationState snapshots.
// The SSE hook reduces events into state; this diffs consecutive snapshots so
// AgentTrace can append log lines without touching the event stream. Keyed by
// `${step}:${status}` so replays/re-renders never duplicate a line.

import type { StepId } from '@/lib/pipeline/types';
import type { ThreadGenerationState } from '@/lib/threadGeneration';

export type TraceLine = {
  key: string;
  glyph: 'ok' | 'run' | 'fail' | 'info';
  text: string;
  amount?: string;
  txHash?: string;
};

const STEP_LABEL: Record<StepId, string> = {
  serper: 'serper.ai · grounding',
  coingecko: 'coingecko · market data',
  groq: 'groq/llama-3.3-70b · drafting',
  factCheck: 'factcheck · verifying claims',
};

const ORDER: StepId[] = ['serper', 'coingecko', 'groq', 'factCheck'];

export function appendTraceLines(
  lines: TraceLine[],
  prev: ThreadGenerationState,
  next: ThreadGenerationState,
): TraceLine[] {
  const out = [...lines];
  const seen = new Set(out.map((l) => l.key));
  const push = (l: TraceLine) => {
    if (!seen.has(l.key)) {
      out.push(l);
      seen.add(l.key);
    }
  };

  for (const id of ORDER) {
    const p = prev.steps[id];
    const n = next.steps[id];
    if (p.status === n.status) continue;
    if (n.status === 'running') {
      push({ key: `${id}:running`, glyph: 'run', text: `${STEP_LABEL[id]}…` });
    } else if (n.status === 'settled') {
      push({
        key: `${id}:settled`,
        glyph: 'ok',
        text: `${STEP_LABEL[id]} — settled`,
        amount: n.costAmount ? `$${n.costAmount}` : undefined,
        txHash: n.txHash,
      });
    } else if (n.status === 'failed') {
      push({
        key: `${id}:failed`,
        glyph: 'fail',
        text: `${STEP_LABEL[id]} — ${n.error ?? 'failed'}`,
      });
    }
  }

  if (!prev.isDone && next.isDone && !next.fatal) {
    push({
      key: 'done',
      glyph: 'ok',
      text: next.totalCostUsd
        ? `run complete — agent spent $${next.totalCostUsd}`
        : 'run complete',
    });
  }
  if (!prev.fatal && next.fatal) {
    push({ key: 'fatal', glyph: 'fail', text: `pipeline fatal — ${next.fatal}` });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm test:lib -- traceLog
# Expected: 4 passed
```

- [ ] **Step 5: Create `components/AgentTrace.tsx`**

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, X, Loader2, Lock } from 'lucide-react';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { appendTraceLines, type TraceLine } from '@/lib/traceLog';
import type { ThreadGenerationState } from '@/lib/threadGeneration';
import type { StepId } from '@/lib/pipeline/types';
import type { PayStatus } from '@/lib/usePayForThread';

const ORDER: StepId[] = ['serper', 'coingecko', 'groq', 'factCheck'];
const CELL_LABEL: Record<StepId, string> = {
  serper: 'SERPER',
  coingecko: 'GECKO',
  groq: 'GROQ',
  factCheck: 'FACT',
};

const PAY_LABEL: Record<PayStatus, string> = {
  idle: 'payment queued',
  approving: 'approving allowance…',
  paying: 'awaiting signature in wallet…',
  'waiting-confirmation': 'confirming on chain…',
  success: 'payment confirmed',
  error: 'payment failed',
};

interface Props {
  gen: ThreadGenerationState;
  payStatus?: PayStatus;
  payTxHash: string | null;
  threadId: bigint | null;
  chainExplorerBase: string;
  agentWalletAddress: string;
}

function totalSpent(gen: ThreadGenerationState): string {
  if (gen.totalCostUsd) return gen.totalCostUsd;
  let sum = 0;
  for (const id of ORDER) {
    const c = gen.steps[id].costAmount;
    if (c) sum += Number(c);
  }
  return sum.toFixed(3);
}

export function AgentTrace({
  gen,
  payStatus,
  payTxHash,
  threadId,
  chainExplorerBase,
  agentWalletAddress,
}: Props) {
  const reduced = useReducedMotion();
  const [lines, setLines] = useState<TraceLine[]>([]);
  const prevRef = useRef<ThreadGenerationState | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev && prev !== gen) {
      setLines((ls) => appendTraceLines(ls, prev, gen));
    }
    prevRef.current = gen;
  }, [gen]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const activeSteps = ORDER.filter((id) => gen.steps[id].status !== 'pending');
  const groq = gen.steps.groq;
  const payLabel = payTxHash
    ? PAY_LABEL.success
    : payStatus
      ? PAY_LABEL[payStatus]
      : 'payment pending';

  return (
    <TerminalPanel className="w-full max-w-md" title={undefined}>
      {/* Header: thread id + running spend total (amber) */}
      <div className="flex items-center justify-between heading-sub text-[10px] mb-3">
        <span>
          THREAD{threadId !== null ? ` #${threadId.toString()}` : ''}
        </span>
        <span className="text-money normal-case tracking-normal font-mono">
          SPENT ${totalSpent(gen)}
        </span>
      </div>

      {/* Layer 1 — pipeline stepper */}
      <div className="flex gap-1.5 mb-3" role="list" aria-label="pipeline steps">
        {activeSteps.map((id) => {
          const s = gen.steps[id];
          const tone =
            s.status === 'settled'
              ? 'border-primary/60 text-primary bg-primary/10'
              : s.status === 'running'
                ? 'border-money/60 text-money bg-money/10'
                : 'border-destructive/60 text-destructive bg-destructive/10';
          return (
            <div
              key={id}
              role="listitem"
              className={`flex-1 rounded-md border px-1 py-1.5 text-center text-[10px] font-mono ${tone}`}
            >
              <div className="font-bold tracking-wider">{CELL_LABEL[id]}</div>
              <div className="mt-0.5">
                {s.status === 'settled' && (s.costAmount ? `✓ $${s.costAmount}` : '✓')}
                {s.status === 'running' && '⣷ run'}
                {s.status === 'failed' && '✗ fail'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Layer 2 — log window */}
      <div
        ref={logRef}
        className="rounded-md border border-border bg-background/60 p-2.5 max-h-44 overflow-y-auto text-[11px] font-mono leading-relaxed"
        aria-live="polite"
      >
        <LogRow glyph={payTxHash ? 'ok' : payStatus === 'error' ? 'fail' : 'run'} text={payLabel} txHash={payTxHash ?? undefined} explorer={chainExplorerBase} amount={payTxHash ? '$0.05' : undefined} />
        {lines.map((l) => (
          <motion.div
            key={l.key}
            initial={reduced ? false : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
          >
            <LogRow glyph={l.glyph} text={l.text} amount={l.amount} txHash={l.txHash} explorer={chainExplorerBase} />
          </motion.div>
        ))}
        {!gen.isDone && !gen.fatal && <span className="cursor-block ml-0.5" aria-hidden />}
      </div>

      {/* Layer 3 — tweet slots: locked while GROQ runs; content only ever
          arrives via step_output AFTER settle (backend invariant). */}
      {groq.status === 'running' && !gen.tweets && (
        <div className="mt-3 rounded-md border border-border border-l-2 border-l-money bg-card p-3">
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <Lock size={12} className="text-money" aria-hidden />
            drafting… tweets unlock when the x402 settle confirms
          </div>
        </div>
      )}

      {gen.fatal && (
        <p className="mt-3 text-xs font-mono text-destructive">
          ✗ pipeline fatal — {gen.fatal}. This run is refundable; nothing was delivered.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-1 text-[11px] font-mono">
        <a
          className="text-muted-foreground"
          href={`${chainExplorerBase}/address/${agentWalletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          agent wallet on explorer →
        </a>
      </div>
    </TerminalPanel>
  );
}

function LogRow({
  glyph,
  text,
  amount,
  txHash,
  explorer,
}: {
  glyph: 'ok' | 'run' | 'fail' | 'info';
  text: string;
  amount?: string;
  txHash?: string;
  explorer: string;
}) {
  const mark =
    glyph === 'ok' ? (
      <Check size={11} className="inline text-primary" aria-label="ok" />
    ) : glyph === 'fail' ? (
      <X size={11} className="inline text-destructive" aria-label="failed" />
    ) : glyph === 'run' ? (
      <Loader2 size={11} className="inline animate-spin text-money" aria-label="running" />
    ) : (
      <span className="text-muted-foreground">·</span>
    );
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="w-3.5 shrink-0 text-center">{mark}</span>
      <span className="flex-1 text-foreground/90">{text}</span>
      {amount && <span className="text-money shrink-0">{amount}</span>}
      {txHash && (
        <a
          className="text-muted-foreground/70 shrink-0 no-underline hover:text-primary"
          href={`${explorer}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          tx:{txHash.slice(0, 6)}…
        </a>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Swap into `app/HomeClient.tsx`**

Replace the dynamic import at lines 72–74:

```tsx
const AgentTrace = dynamic(
  () => import('@/components/AgentTrace').then((m) => m.AgentTrace),
  { ssr: false },   // keep whatever loading/ssr options the current import has
);
```

and the JSX at the `screen === 'generating'` branch: `<GeneratingStatus …/>` → `<AgentTrace …/>` (props unchanged). Delete `components/GeneratingStatus.tsx`:

```bash
rm components/GeneratingStatus.tsx
grep -rn "GeneratingStatus" app components   # expect: no matches
```

- [ ] **Step 7: Verify + commit**

```bash
pnpm test:lib && pnpm build   # expect: pass
```

Manual: run a testnet generation (or temporarily feed the reducer canned events) and watch: stepper cells appear as steps start, amounts land amber, locked slot shows during GROQ, tweets screen unchanged after `done`.

```bash
git add lib/traceLog.ts lib/traceLog.test.ts components/AgentTrace.tsx app/HomeClient.tsx components/GeneratingStatus.tsx
git commit -m "feat(ui): AgentTrace mission-control hero replaces GeneratingStatus"
```

---

## Global restyle mapping (Tasks 4–7)

Apply this table mechanically in every file each task touches. It is the whole recipe; per-task sections list only the files and anything file-specific.

| Old (codex) | New (terminal) |
|---|---|
| `<InkText as="h2" className="…" delay={…}>X</InkText>` | `<h2 className="…">X</h2>` (drop `font-display italic` from className; headings are mono-bold via base CSS) |
| `<InkDivider />` | `<RuleDivider />` from `@/components/terminal/RuleDivider` |
| `<Marginalia side="…">…</Marginalia>` | `<TraceNote side="…">…</TraceNote>` from `@/components/terminal/TraceNote` |
| `<CodexFrame …/>` | delete the element (decorative underlay) |
| `<FolioMark …/>`, `<InkBlot …/>`, `<MirrorScript …/>` | delete the element |
| `IllumQuill / IllumShield / IllumFlame / IllumGraduationCap / IllumCoin` | lucide `PenLine / ShieldCheck / Flame / GraduationCap / Coins`, size 16–20 |
| `font-display italic` / `font-display` | `font-mono font-bold tracking-tight` |
| `codex-card`, `folio`, `drop-cap` classes | remove class |
| `ornament` prop on `<Card>` | remove prop |
| `text-[hsl(var(--ink-faded))]` | `text-muted-foreground` |
| `text-[hsl(var(--ink-deep))]` | `text-foreground` |
| `dark:*` variants in touched files | inline the dark value as the only value (single theme) |
| Any rendered $ amount / price / cost | wrap: `<span className="font-mono text-money">…</span>` |
| Section labels ("Folio II", roman numerals, "№") | plain terminal copy: `STEP 01`, `#4821`, uppercase `.heading-sub` |
| Copy tone ("calligraphing", "folio", "ink", "quill") | agent tone: "agent drafting…", "run", "trace", "settled" |

After each task: `grep -n "InkText\|InkDivider\|Marginalia\|CodexFrame\|Illum\|FolioMark\|InkBlot\|MirrorScript" <touched files>` must return nothing.

---

### Task 4: Compose screens

**Files (modify):**
- `components/ModePicker.tsx` (rewrite below)
- `components/EducationalInput.tsx`, `components/HotTakeInput.tsx`, `components/TokenAnalysisInput.tsx`, `components/DailyRecapInput.tsx` — apply mapping table; text inputs get prompt styling: container `rounded-md border border-input bg-card px-3 py-2 font-mono text-sm`, with a `<span className="text-primary select-none">&gt;&nbsp;</span>` prefix inside the field wrapper (before the `<input>`/`<textarea>`, which becomes `bg-transparent border-0 focus:ring-0 flex-1`).
- `components/ComposeSummary.tsx`, `components/TokenSelector.tsx`, `components/WalletStatus.tsx`, `components/WalletMenu.tsx` — mapping table only; token balances and prices are money-amber.

**Interfaces:**
- Consumes: Task 2 primitives.
- Produces: no interface changes — every component keeps its existing props exactly (`ModePicker` keeps `onSelect(mode)` with the same union type; on-chain ids untouched).

- [ ] **Step 1: Rewrite `components/ModePicker.tsx`**

Keep the `MODES` array data (ids, labels, blurbs, costs, badges, the on-chain-id warning comment) — replace imports and rendering:

```tsx
'use client';

import { ArrowRight, Flame, GraduationCap, Coins, PenLine } from 'lucide-react';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';

interface Props {
  onSelect: (mode: 'educational' | 'hot-take' | 'token-analysis' | 'daily-recap') => void;
}

// … keep the existing Mode interface and MODES array (including the on-chain
// mode-id comment) — only swap each mode's Icon to the lucide equivalents:
// hot-take: Flame, educational: GraduationCap, token-analysis: Coins,
// daily-recap: PenLine.

export function ModePicker({ onSelect }: Props) {
  return (
    <TerminalPanel title="SELECT MODE" className="w-full max-w-md">
      <ul className="flex flex-col gap-2">
        {MODES.map((m, i) => (
          <li key={m.id}>
            <button
              onClick={() => onSelect(m.id)}
              className="w-full text-left rounded-md border border-border bg-background/50 p-3 font-mono transition-colors hover:border-primary/50 hover:bg-primary/5 active:bg-primary/10"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-muted-foreground text-[10px] w-6">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <m.Icon size={16} className="text-primary shrink-0" aria-hidden />
                <span className="font-bold text-sm flex-1">{m.label}</span>
                <span className="text-money text-xs">{m.cost}</span>
                <ArrowRight size={14} className="text-muted-foreground" aria-hidden />
              </div>
              <p className="mt-1.5 pl-[3.35rem] text-xs text-muted-foreground leading-snug">
                {m.blurb}
              </p>
              {m.badge && (
                <p className="mt-1 pl-[3.35rem] text-[10px] text-primary/70 tracking-wide">
                  [{m.badge}]
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
    </TerminalPanel>
  );
}
```

- [ ] **Step 2: Apply the mapping table to the 7 remaining files** (inputs ×4, ComposeSummary, TokenSelector, WalletStatus, WalletMenu). Grep-verify per the mapping section.

- [ ] **Step 3: Verify + commit**

```bash
pnpm test:lib && pnpm build
```
Manual at 360×740: mode → each input screen → summary; keyboard-open behavior unchanged (HomeClient logic untouched).

```bash
git add components/ModePicker.tsx components/EducationalInput.tsx components/HotTakeInput.tsx components/TokenAnalysisInput.tsx components/DailyRecapInput.tsx components/ComposeSummary.tsx components/TokenSelector.tsx components/WalletStatus.tsx components/WalletMenu.tsx
git commit -m "feat(ui): terminal compose screens — ModePicker, inputs, summary, wallet"
```

---

### Task 5: Landing hero with replay trace

**Files:**
- Create: `components/AgentTraceReplay.tsx`
- Modify: `components/LandingHero.tsx` (rewrite hero copy/visual; keep its existing props and CTA wiring exactly)

**Interfaces:**
- Consumes: `initialState`, `applyEvent` from `@/lib/threadGeneration` (reuses the production reducer — replay is a canned `PipelineEvent[]`, zero spend, no fetch); `AgentTrace` from Task 3.
- Produces: `AgentTraceReplay()` — no props; self-loops.

- [ ] **Step 1: Create `components/AgentTraceReplay.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { AgentTrace } from '@/components/AgentTrace';
import { initialState, applyEvent } from '@/lib/threadGeneration';
import type { ThreadGenerationState } from '@/lib/threadGeneration';
import type { PipelineEvent } from '@/lib/pipeline/types';

// Canned Mode-B run replayed through the REAL reducer — the landing demo is
// the actual generating screen, not a mock. Loops forever; costs nothing.
const SCRIPT: { at: number; e: PipelineEvent }[] = [
  { at: 400,  e: { type: 'started' } },
  { at: 900,  e: { type: 'step_started', step: 'serper' } },
  { at: 2200, e: { type: 'step_settled', step: 'serper', txHash: '0x7b71d5f7aa11de0c90b1a2c3d4e5f60718293a4b5c6d7e8f9012345678904821', costAmount: '0.010', tokenSymbol: 'cUSD' } },
  { at: 2600, e: { type: 'step_started', step: 'coingecko' } },
  { at: 3800, e: { type: 'step_settled', step: 'coingecko', txHash: '0x91ac0000000000000000000000000000000000000000000000000000000091ac', costAmount: '0.005', tokenSymbol: 'cUSD' } },
  { at: 4200, e: { type: 'step_started', step: 'groq' } },
  { at: 7200, e: { type: 'step_settled', step: 'groq', txHash: '0x33bd0000000000000000000000000000000000000000000000000000000033bd', costAmount: '0.001', tokenSymbol: 'cUSD' } },
  { at: 7600, e: { type: 'step_started', step: 'factCheck' } },
  { at: 9200, e: { type: 'step_settled', step: 'factCheck', txHash: '0x55ef0000000000000000000000000000000000000000000000000000000055ef', costAmount: '0.001', tokenSymbol: 'cUSD' } },
  { at: 9700, e: { type: 'done', totalCostUsd: '0.017' } },
];
const LOOP_MS = 12_000;

export function AgentTraceReplay() {
  const [state, setState] = useState<ThreadGenerationState>(initialState);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const timers = SCRIPT.map(({ at, e }) =>
      setTimeout(() => setState((s) => applyEvent(s, e)), at),
    );
    const loop = setTimeout(() => {
      setState(initialState);
      setCycle((c) => c + 1);
    }, LOOP_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(loop);
    };
  }, [cycle]);

  return (
    <div key={cycle} aria-hidden className="pointer-events-none select-none">
      <AgentTrace
        gen={state}
        payTxHash={'0xdemo000000000000000000000000000000000000000000000000000000000000'}
        threadId={4821n}
        chainExplorerBase="https://celoscan.io"
        agentWalletAddress="0x0000000000000000000000000000000000000000"
      />
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `components/LandingHero.tsx`**

Keep the file's existing props and CTA handlers (read the file; the connect/start buttons and any wagmi wiring stay byte-identical). Replace the visual shell: heading block above, `<AgentTraceReplay />` below, then the CTA `Button`.

Heading block:

```tsx
<div className="text-center flex flex-col items-center gap-2">
  <p className="heading-sub text-[10px]">SHIPPOST // AGENT</p>
  <h1 className="text-3xl font-bold tracking-tight">
    Your agent writes, <span className="text-primary">pays</span>, ships.
  </h1>
  <p className="text-sm text-muted-foreground max-w-xs font-mono">
    Pay <span className="text-money">$0.05</span> once — an on-chain agent pays
    AI services per call (x402) and delivers a ready-to-post X thread.
  </p>
</div>
```

Apply the mapping table to the rest of the file (remove `CodexFrame`, `InkText`, ornaments).

- [ ] **Step 3: Verify + commit**

```bash
pnpm test:lib && pnpm build
```
Manual: landing shows the trace looping every ~12s; CTA flows unchanged.

```bash
git add components/AgentTraceReplay.tsx components/LandingHero.tsx
git commit -m "feat(ui): terminal landing hero with looping AgentTrace replay demo"
```

---

### Task 6: Preview, editor, share, errors

**Files (modify, mapping table + notes below):**
- `components/ThreadPreview.tsx` — tweet text blocks switch to `font-sans text-[15px] leading-normal` on `bg-card` (Inter = the deliverable); all chrome (counters, indices, buttons) stays mono. Keep the banned-phrase highlight logic untouched; change its highlight classes to `bg-money/20 text-money underline decoration-money/60`.
- `components/PreviewLocked.tsx` — locked-state visual: `Lock` icon + `border-l-2 border-l-money`, copy "unlocks after payment".
- `components/ShareToX.tsx`, `components/PostShareScreen.tsx` — mapping table only.
- `components/ErrorSurface.tsx` — error panel: `border-destructive/50 bg-destructive/10`, mono copy prefixed `✗ `; when a refund state is shown, render the line `auto refund queued — nothing was delivered` in `text-muted-foreground` under the error.
- `components/UrlPreviewCard.tsx` — mapping table only.

**Interfaces:** none change — props of every component stay identical.

- [ ] **Step 1: Apply mapping + notes above, file by file.** Grep-verify per the mapping section.
- [ ] **Step 2: Verify + commit**

```bash
pnpm test:lib && pnpm build
```
Manual: run preview with a banned phrase in the editor — highlight now amber; error surface via airplane-mode retry.

```bash
git add components/ThreadPreview.tsx components/PreviewLocked.tsx components/ShareToX.tsx components/PostShareScreen.tsx components/ErrorSurface.tsx components/UrlPreviewCard.tsx
git commit -m "feat(ui): terminal preview/editor, share and error surfaces"
```

---

### Task 7: History, stats, HomeClient shell

**Files (modify):**
- `app/history/page.tsx`, `components/HistoryList.tsx` — log-table rows: each thread one mono row `[#id] [mode] [date] [$cost amber] [status glyph]`, `border-b border-border`, no cards.
- `app/stats/page.tsx` — stat cards: `TerminalPanel` per stat, value `text-2xl font-bold font-mono`, $ values `text-money`.
- `app/HomeClient.tsx` — apply mapping table to the shell (it imports `ColophonIndex`, `FolioSpread`, `RightLeafPlaceholder`, `MirrorScript`, `InkBlot`, `InkText`, `FolioMark`, `InkDivider`, `Marginalia`): delete decorative elements (`FolioSpread` wrapper → plain `div` keeping the same layout classes; `MirrorScript`/`InkBlot`/`FolioMark`/`RightLeafPlaceholder` elements removed; `ColophonIndex` → keep the component call ONLY if it renders navigation (read it first); if decorative-only, delete the call). **Do not touch state, handlers, or the screen state machine.**

**Interfaces:** none change.

- [ ] **Step 1: Apply per-file notes + mapping table.** Grep-verify.
- [ ] **Step 2: Verify + commit**

```bash
pnpm test:lib && pnpm build
```
Manual: /history and /stats at 360×740; full click-through of the home state machine (mode → input → generating → preview → post-share → back to mode).

```bash
git add app/history/page.tsx app/stats/page.tsx app/HomeClient.tsx components/HistoryList.tsx
git commit -m "feat(ui): terminal history, stats and home shell"
```

---

### Task 8: Delete dead codex components, purge compat aliases

**Files:**
- Delete: `components/InkText.tsx`, `components/InkBlot.tsx`, `components/InkDivider.tsx`, `components/Marginalia.tsx`, `components/MirrorScript.tsx`, `components/FolioSpread.tsx`, `components/FolioMark.tsx`, `components/RightLeafPlaceholder.tsx`, `components/CodexFrame.tsx`, `components/IllumIcons.tsx`, and `components/ColophonIndex.tsx` **if** Task 7 removed its last call site.
- Modify: `app/globals.css` — delete the "Compat shims" block (`.codex-card`, `.folio::before`, `.drop-cap`, `.ink-draw`) and the compat alias vars (`--ink-deep`, `--ink-faded`, `--vermillion`).
- Modify: `tailwind.config.ts` — delete the `display` fontFamily alias.
- Modify: `components/ui/card.tsx` — remove the `ornament` prop entirely.
- Modify: `components/motion/ScreenTransition.tsx` + `components/motion/Stagger.tsx` — reduce to fade/slide only if they carry codex-specific effects (read first; if already minimal, leave).

**Interfaces:** removals only; nothing may still consume them.

- [ ] **Step 1: Prove they're dead, then delete**

```bash
grep -rn "InkText\|InkBlot\|InkDivider\|Marginalia\|MirrorScript\|FolioSpread\|FolioMark\|RightLeafPlaceholder\|CodexFrame\|IllumIcons\|ink-faded\|ink-deep\|vermillion\|codex-card\|drop-cap\|font-display\|ornament" app components lib
# Expected: matches ONLY inside the files being deleted / the css+config lines being removed.
```

Delete the files, then remove the CSS/config/`ornament` remnants listed above.

- [ ] **Step 2: Sweep leftover `dark:` variants**

```bash
grep -rn "dark:" app components | grep -v node_modules
```
Inline each remaining `dark:` value as the only value (single theme), then remove the `dark` class from `<html>` in `app/layout.tsx` and change `darkMode: ['class']` handling is left as-is (harmless).

- [ ] **Step 3: Final verification**

```bash
pnpm test:lib && pnpm build && pnpm lint
# Expected: all pass; build output shows IM Fell / EB Garamond no longer in the font manifest.
```
Manual: full app click-through at 360×740 — landing, all 4 modes, a real testnet generation end-to-end, history, stats, share.

- [ ] **Step 4: Commit**

```bash
git add -u && git add app components tailwind.config.ts
git commit -m "chore(ui): delete codex components and compat aliases — terminal migration complete"
```

---

## Self-review notes (done at write time)

- **Spec coverage:** tokens (T1), typography (T1), scanline+uppercase (T1), primitives map (T2), AgentTrace mission control + lock-on-settle (T3), replay landing (T5), compose (T4), preview/editor/share/errors (T6), history/stats (T7), deletions + theme-color + ThemeApplicator (T1/T8), motion reduction (T3 uses 1 pattern + cursor; T8 checks ScreenTransition/Stagger). Spec's "2-button ModePicker" corrected to 4 modes (reality; noted in Global Constraints).
- **Type consistency:** `AgentTrace` props == `GeneratingStatus` props (verified against source); `TraceLine`/`appendTraceLines` signatures match between test, lib, and component; `RuleDivider`/`TraceNote` prop-compatible with `InkDivider`/`Marginalia` (verified against source).
- **Known judgment calls left to the implementer, bounded:** exact loading options on the dynamic import (copy existing), `ColophonIndex` keep-or-delete rule stated in T7, motion files "read first; leave if minimal" in T8.
