# Terminal / Paper Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second colour theme ("Paper") and a header toggle, without changing what a first-time visitor sees.

**Architecture:** `:root` keeps the existing Terminal palette byte-for-byte; Paper is an additive `html.theme-paper` override of the same token names. A blocking inline `<script>` in `<head>` resolves the stored choice before the first paint, so there is no flash. All theme logic that can be tested lives in `lib/`, because `components/` is outside this repo's vitest scope.

**Tech Stack:** Next.js 14 App Router, Tailwind (already `darkMode: ['class']`, all colours token-mapped), Vitest, Playwright (not a repo dependency — install in the scratchpad).

**Spec:** `docs/superpowers/specs/2026-08-28-theme-system-design.md`

## Global Constraints

- **The Terminal palette in `:root` is not restyled.** The one exception is `--destructive-foreground`, which fails WCAG AA today (2.90:1) and is fixed in Task 2. No other Terminal token changes.
- **Colour semantics are fixed in both themes:** green = action/agent, amber = money, red = error (`app/globals.css:6-8`). Paper changes lightness, never meaning.
- **Terminal is the default for every unrecognised stored value.** Only the exact string `'paper'` opts in.
- **`prefers-color-scheme` is not read anywhere.** Deliberate; see the spec.
- **Never edit `app/opengraph-image.tsx`, `app/icon.png`, or `app/apple-icon.png`.** Brand artwork stays dark.
- **Do not introduce `dark:` Tailwind variants.** The repo has zero and the token layer is the whole mechanism.
- **Testable logic goes in `lib/`.** `test:lib` is `vitest run lib app`; a `.tsx` under `components/` is never executed by the suite.
- Every task ends green on: `npx tsc --noEmit`, `pnpm lint`, `pnpm test:lib`.

## File Structure

| File | Responsibility |
|---|---|
| `lib/theme.ts` (create) | Theme type, storage key, class name, per-theme `theme-color`, pure `resolveTheme` / `nextTheme` |
| `lib/theme.test.ts` (create) | Unit tests for the above |
| `lib/themeContrast.test.ts` (create) | Parses `app/globals.css` and asserts WCAG AA for every palette in it |
| `app/globals.css` (modify) | Fix `--destructive-foreground`; add the `html.theme-paper` block; make `.scanlines` token-driven |
| `app/layout.tsx` (modify) | Blocking pre-paint script; `theme-color` meta rendered as a real tag |
| `components/ThemeToggle.tsx` (create) | The 36×36 header nib; reads/writes the class, storage and meta |
| `app/HomeClient.tsx` (modify) | Mount the toggle in the header |
| `app/providers.tsx` (modify) | RainbowKit theme follows the app theme (fixes today's white modal) |

---

### Task 1: Pure theme logic in `lib/`

**Files:**
- Create: `lib/theme.ts`
- Test: `lib/theme.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type Theme = 'terminal' | 'paper'`; `THEME_STORAGE_KEY: string`; `PAPER_CLASS: string`; `THEME_COLOR: Record<Theme, string>`; `resolveTheme(stored: string | null | undefined): Theme`; `nextTheme(current: Theme): Theme`. Tasks 2–6 all import from here.

- [x] **Step 1: Write the failing test**

Create `lib/theme.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  THEME_STORAGE_KEY,
  PAPER_CLASS,
  THEME_COLOR,
  resolveTheme,
  nextTheme,
} from './theme';

describe('resolveTheme', () => {
  // Terminal is the default for everything unrecognised. A first-time
  // visitor, a cleared browser, a value written by an older build, or a
  // string typed into devtools must all land on the brand's own surface.
  it('falls back to terminal for anything that is not exactly "paper"', () => {
    for (const stored of [null, undefined, '', 'dark', 'light', 'PAPER', 'Paper', '{}']) {
      expect(resolveTheme(stored)).toBe('terminal');
    }
  });

  it('opts in on the exact string "paper"', () => {
    expect(resolveTheme('paper')).toBe('paper');
  });
});

describe('nextTheme', () => {
  it('toggles between the two themes', () => {
    expect(nextTheme('terminal')).toBe('paper');
    expect(nextTheme('paper')).toBe('terminal');
  });

  it('round-trips', () => {
    expect(nextTheme(nextTheme('terminal'))).toBe('terminal');
  });
});

describe('constants', () => {
  it('names a theme-color for both themes', () => {
    expect(THEME_COLOR.terminal).toMatch(/^#[0-9A-F]{6}$/i);
    expect(THEME_COLOR.paper).toMatch(/^#[0-9A-F]{6}$/i);
    expect(THEME_COLOR.terminal).not.toBe(THEME_COLOR.paper);
  });

  // The storage key and class name are baked into the inline <head> script in
  // app/layout.tsx, which cannot import this module. Changing either here
  // without changing that script silently breaks theme restoration, so pin
  // both values.
  it('pins the values the inline script duplicates', () => {
    expect(THEME_STORAGE_KEY).toBe('coinop-theme');
    expect(PAPER_CLASS).toBe('theme-paper');
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `npx vitest run lib/theme.test.ts`
Expected: FAIL — `Failed to resolve import "./theme"`.

- [x] **Step 3: Write the implementation**

Create `lib/theme.ts`:

```ts
/**
 * The two palettes, and the pure logic for choosing between them.
 *
 * Lives in lib/ rather than beside the toggle component on purpose: `test:lib`
 * runs `vitest run lib app`, so anything under components/ is never executed by
 * the suite and this repo has no component-render harness.
 */
export type Theme = 'terminal' | 'paper';

/**
 * Duplicated verbatim inside the inline <head> script in app/layout.tsx, which
 * runs before any module loads and therefore cannot import this file. The test
 * pins both values so the two copies cannot drift apart in silence.
 */
export const THEME_STORAGE_KEY = 'coinop-theme';
export const PAPER_CLASS = 'theme-paper';

/**
 * The <meta name="theme-color"> content per theme. Must equal that palette's
 * --background, or the phone's status bar sits in the other theme; the
 * contrast test asserts the match against app/globals.css.
 */
export const THEME_COLOR: Record<Theme, string> = {
  terminal: '#0A0D0A',
  paper: '#F2F0E6',
};

/**
 * Terminal is the answer to every question this cannot parse. The brand's own
 * surface is what a stranger should meet; Paper is only ever reached by an
 * explicit, exact opt-in.
 */
export function resolveTheme(stored: string | null | undefined): Theme {
  return stored === 'paper' ? 'paper' : 'terminal';
}

export function nextTheme(current: Theme): Theme {
  return current === 'terminal' ? 'paper' : 'terminal';
}
```

- [x] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run lib/theme.test.ts`
Expected: PASS, 6 tests.

- [x] **Step 5: Full gate**

Run: `npx tsc --noEmit && pnpm lint && pnpm test:lib`
Expected: tsc exit 0, "No ESLint warnings or errors", all tests pass.

- [x] **Step 6: Commit**

```bash
git add lib/theme.ts lib/theme.test.ts
git commit -m "feat(theme): pure theme resolution, in lib so it is actually tested"
```

---

### Task 2: Contrast test, and the dark-palette defect it finds

The contrast test is the load-bearing test of this whole feature. Build it against the palette that already exists, before Paper is written — that way its first job is to catch a real defect rather than to rubber-stamp new code.

**That defect is real and pre-existing:** `--destructive-foreground` (`0 0% 98%`, near-white) on `--destructive` (`0 100% 68%`, a light red) measures **2.90:1**. It is used by `components/ui/button.tsx:20` and `components/ui/badge.tsx:16`.

**Files:**
- Create: `lib/themeContrast.test.ts`
- Modify: `app/globals.css:23`

**Interfaces:**
- Consumes: `THEME_COLOR` from `lib/theme.ts` (Task 1).
- Produces: `PAIRS` and the parsing helpers stay private to the test file. Task 3 extends the `describe.each` list in this file with `['Paper', 'html.theme-paper']`.

- [x] **Step 1: Write the failing test**

Create `lib/themeContrast.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_COLOR } from './theme';

/**
 * The palettes are CSS custom properties, so this reads app/globals.css as the
 * single source rather than keeping a second copy of the values in TypeScript
 * that could drift. It is the test that lets a light theme ship at all: without
 * it "the light theme is readable" would be a claim rather than a property, and
 * it guards the dark palette from drift at the same time.
 */
type Hsl = [number, number, number];

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

function ruleBody(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`no "${selector}" rule in app/globals.css`);
  const end = CSS.indexOf('\n  }', at);
  if (end === -1) throw new Error(`unterminated "${selector}" rule`);
  return CSS.slice(at, end);
}

function tokensOf(selector: string): Record<string, Hsl> {
  const out: Record<string, Hsl> = {};
  for (const m of ruleBody(selector).matchAll(
    /--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g,
  )) {
    out[m[1]] = [Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100];
  }
  return out;
}

function backgroundHex(selector: string): string {
  const m = ruleBody(selector).match(/--background:[^;]+;\s*\/\*\s*(#[0-9A-Fa-f]{6})/);
  if (!m) throw new Error(`"${selector}" has no --background hex comment`);
  return m[1].toUpperCase();
}

function relLuminance([h, s, l]: Hsl): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  const [r, g, b] = t.map((v) =>
    v + m <= 0.03928 ? (v + m) / 12.92 : ((v + m + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Hsl, b: Hsl): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every foreground token against every ground it is actually painted on. */
const PAIRS: [string, string][] = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['card-foreground', 'card'],
  ['primary', 'background'],
  ['primary', 'card'],
  ['primary', 'secondary'],
  ['money', 'background'],
  ['money', 'card'],
  ['money', 'secondary'],
  ['destructive', 'background'],
  ['destructive', 'card'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'secondary'],
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
];

const PALETTES: [string, string][] = [['Terminal', ':root']];

describe.each(PALETTES)('%s palette', (_name, selector) => {
  const tokens = tokensOf(selector);

  it.each(PAIRS)('--%s on --%s clears WCAG AA (4.5:1)', (fg, bg) => {
    expect(tokens[fg], `--${fg} missing from ${selector}`).toBeDefined();
    expect(tokens[bg], `--${bg} missing from ${selector}`).toBeDefined();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('theme-color', () => {
  // A mismatch here paints the phone status bar in the other theme.
  it('matches the Terminal background', () => {
    expect(backgroundHex(':root')).toBe(THEME_COLOR.terminal.toUpperCase());
  });
});
```

- [x] **Step 2: Run it and watch it catch the real defect**

Run: `npx vitest run lib/themeContrast.test.ts`
Expected: FAIL, exactly one pair — `--destructive-foreground on --destructive` — with a received value of about `2.90`. Every other pair passes. If anything else fails, stop and report rather than adjusting the threshold.

- [x] **Step 3: Fix the palette, not the test**

In `app/globals.css`, replace line 23:

```css
    --destructive-foreground: 0 0% 98%;
```

with:

```css
    /* Dark ink on the light red, the same way --primary-foreground is dark ink
       on the bright phosphor. Near-white here measured 2.90:1, below AA, on the
       destructive Button and Badge variants. */
    --destructive-foreground: 0 40% 8%;    /* 6.24:1 on --destructive */
```

- [x] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run lib/themeContrast.test.ts`
Expected: PASS, 20 tests.

- [x] **Step 5: Full gate**

Run: `npx tsc --noEmit && pnpm lint && pnpm test:lib`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add lib/themeContrast.test.ts app/globals.css
git commit -m "test(theme): assert WCAG AA over globals.css, and fix the pair it caught"
```

---

### Task 3: The Paper palette

**Files:**
- Modify: `app/globals.css` (add a rule after the `:root` block; retheme `.scanlines`)
- Modify: `lib/themeContrast.test.ts` (extend `PALETTES` and the theme-color test)

**Interfaces:**
- Consumes: the parsing helpers and `PAIRS` in `lib/themeContrast.test.ts` (Task 2), `THEME_COLOR` from `lib/theme.ts` (Task 1).
- Produces: the CSS class `theme-paper`, applied to `<html>` by Tasks 4 and 5.

- [x] **Step 1: Write the failing test**

In `lib/themeContrast.test.ts`, replace the `PALETTES` constant:

```ts
const PALETTES: [string, string][] = [
  ['Terminal', ':root'],
  ['Paper', 'html.theme-paper'],
];
```

and replace the whole `describe('theme-color', …)` block with:

```ts
describe('theme-color', () => {
  // A mismatch here paints the phone status bar in the other theme.
  it.each([
    ['terminal', ':root'],
    ['paper', 'html.theme-paper'],
  ] as const)('matches the %s background', (theme, selector) => {
    expect(backgroundHex(selector)).toBe(THEME_COLOR[theme].toUpperCase());
  });
});
```

- [x] **Step 2: Run it and confirm it fails**

Run: `npx vitest run lib/themeContrast.test.ts`
Expected: FAIL — `no "html.theme-paper" rule in app/globals.css`.

- [x] **Step 3: Add the Paper palette**

In `app/globals.css`, immediately after the closing `}` of the `:root` block (currently line 31) and still inside the same `@layer base { … }`, add:

```css
  /* Paper — the receipt this machine prints.
     Opt-in only (lib/theme.ts); Terminal above is untouched, so the default
     render path cannot regress. Same token names and the same colour
     SEMANTICS — green = action/agent, amber = money, red = error — with only
     lightness inverted. Every pair here is asserted at WCAG AA by
     lib/themeContrast.test.ts; do not hand-tune a value without re-running it. */
  html.theme-paper {
    --background: 50 32% 93%;              /* #F2F0E6 */
    --foreground: 105 8% 9%;               /* #171A16 */
    --card: 51 47% 97%;                    /* #FBFAF4 */
    --card-foreground: 105 8% 9%;
    --primary: 140 78% 27%;                /* #0F7A33 — phosphor, as ink */
    --primary-foreground: 51 47% 97%;
    --secondary: 48 32% 91%;               /* #EFECE0 */
    --secondary-foreground: 105 8% 9%;
    --muted: 48 32% 91%;
    --muted-foreground: 94 3% 41%;         /* #676B64 */
    --accent: 102 22% 91%;                 /* #E6EDE3 */
    --accent-foreground: 105 8% 9%;
    --destructive: 3 71% 41%;              /* #B3261E */
    --destructive-foreground: 51 47% 97%;
    --border: 49 22% 81%;                  /* #D9D5C4 */
    --input: 48 18% 73%;                   /* #C7C2AE */
    --ring: 140 78% 27%;

    /* Terminal extras */
    --money: 39 100% 27%;                  /* #8A5A00 — amber, as ochre */
  }
```

- [x] **Step 4: Make the scanlines follow the theme**

`.scanlines` currently hardcodes a near-black line, which reads as a smudge on paper. Add a token to **both** palettes and reference it.

In the `:root` block, after `--money`, add:

```css
    /* CRT line colour for .scanlines, incl. its alpha. */
    --scanline: 120 40% 2% / 0.35;
```

In the `html.theme-paper` block, after its `--money`, add:

```css
    /* On paper the same texture is a press halftone, not a CRT: warm, faint. */
    --scanline: 40 20% 45% / 0.10;
```

Then replace the `.scanlines` rule (currently `app/globals.css:136-144`) with:

```css
.scanlines {
  background-image: repeating-linear-gradient(
    0deg,
    transparent 0px,
    transparent 2px,
    hsl(var(--scanline)) 2px,
    hsl(var(--scanline)) 3px
  );
}
```

Note `--scanline` carries its own alpha, so it does not match the `H S% L%` pattern the contrast test parses and is correctly ignored by it.

- [x] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run lib/themeContrast.test.ts`
Expected: PASS, 40 tests (19 pairs × 2 palettes, plus 2 theme-color assertions). If any Paper pair fails, adjust that Paper token — never the 4.5 threshold.

- [x] **Step 6: Full gate**

Run: `npx tsc --noEmit && pnpm lint && pnpm test:lib`
Expected: all green.

- [x] **Step 7: Commit**

```bash
git add app/globals.css lib/themeContrast.test.ts
git commit -m "feat(theme): add the Paper palette, proven AA by the contrast test"
```

---

### Task 4: Resolve the theme before the first paint

This is the task that avoids the defect that killed the previous attempt: `ThemeApplicator` resolved in `useEffect`, i.e. after paint, so every affected user saw the wrong theme and then a swap.

**Files:**
- Modify: `app/layout.tsx:60-67` (viewport) and `:74-76` (the `<html>`/`<body>` opening)

**Interfaces:**
- Consumes: `THEME_STORAGE_KEY`, `PAPER_CLASS`, `THEME_COLOR` from `lib/theme.ts` (Task 1).
- Produces: `<html>` carries `class="theme-paper"` on first paint when storage says so, and a `<meta name="theme-color">` tag that Task 5 updates by `document.querySelector('meta[name="theme-color"]')`.

- [x] **Step 1: Remove the static themeColor from the viewport export**

The `viewport` export is rendered server-side and cannot know the user's choice. Replace `app/layout.tsx:60-67` with:

```ts
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // No themeColor here on purpose: it is per-user now, so the tag is written
  // by the pre-paint script below and updated by the toggle. A static value
  // would paint the status bar in whichever theme the user is not using.
};
```

- [x] **Step 2: Add the blocking pre-paint script**

In `app/layout.tsx`, add the import:

```ts
import { THEME_STORAGE_KEY, PAPER_CLASS, THEME_COLOR } from '@/lib/theme';
```

and replace the `<html …>` opening and the start of `<body>` (currently `:75-76`) with:

```tsx
    <html lang="en" className={`${mono.variable} ${inter.variable}`}>
      <head>
        {/*
          Resolve the theme BEFORE the first paint. The previous attempt at this
          (components/ThemeApplicator.tsx, deleted in 32aedf2) ran in useEffect
          and its own docstring conceded "there is a brief flash" — every user
          saw the wrong theme and then a swap. A blocking script in <head> is
          the only place that cannot happen.

          It duplicates the storage key and class name from lib/theme.ts because
          it runs before any module loads; lib/theme.test.ts pins both values so
          the copies cannot drift. Wrapped in try/catch: Safari private mode
          throws on localStorage access, and a throw here would blank the page.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem(${JSON.stringify(
              THEME_STORAGE_KEY,
            )})==='paper';if(p)document.documentElement.classList.add(${JSON.stringify(
              PAPER_CLASS,
            )});var m=document.createElement('meta');m.name='theme-color';m.content=p?${JSON.stringify(
              THEME_COLOR.paper,
            )}:${JSON.stringify(
              THEME_COLOR.terminal,
            )};document.head.appendChild(m);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
```

- [x] **Step 3: Verify no flash, with Playwright**

Playwright is not a repo dependency. In the scratchpad:

```bash
npm i playwright --no-save && npx playwright install chromium
```

Start the dev server: `pnpm dev --port 3111`

Then run this script from the scratchpad:

```js
import { chromium } from 'playwright';
const b = await chromium.launch();

// Seed the choice BEFORE the app ever loads, then assert the very first paint
// is already correct — this is the assertion the old ThemeApplicator failed.
const ctx = await b.newContext({ viewport: { width: 360, height: 740 } });
const p = await ctx.newPage();
await p.addInitScript(() => localStorage.setItem('coinop-theme', 'paper'));
const classes = [];
await p.exposeFunction('__report', (c) => classes.push(c));
await p.addInitScript(() => {
  document.addEventListener('readystatechange', () =>
    window.__report(document.documentElement.className));
});
await p.goto('http://localhost:3111/', { waitUntil: 'networkidle' });
console.log('html class at each readystate:', JSON.stringify(classes));
console.log('final html class:', await p.evaluate(() => document.documentElement.className));
console.log('theme-color:', await p.evaluate(() =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute('content')));
console.log('body background:', await p.evaluate(() =>
  getComputedStyle(document.body).backgroundColor));
await ctx.close();

// And the default path: no stored value must render Terminal.
const ctx2 = await b.newContext({ viewport: { width: 360, height: 740 } });
const p2 = await ctx2.newPage();
await p2.goto('http://localhost:3111/', { waitUntil: 'networkidle' });
console.log('default html class:', JSON.stringify(await p2.evaluate(() => document.documentElement.className)));
console.log('default theme-color:', await p2.evaluate(() =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute('content')));
console.log('default body background:', await p2.evaluate(() =>
  getComputedStyle(document.body).backgroundColor));
await b.close();
```

Expected:
- every reported class already contains `theme-paper` — never an empty string first;
- `theme-color` is `#F2F0E6`, body background `rgb(242, 240, 230)`;
- the default context has **no** `theme-paper` class, `theme-color` `#0A0D0A`, body background `rgb(10, 13, 10)`.

- [x] **Step 4: Full gate**

Run: `npx tsc --noEmit && pnpm lint && pnpm test:lib && pnpm build`
Expected: all green. `pnpm build` matters here — `<head>` in a Server Component layout is easy to get wrong.

- [x] **Step 5: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(theme): resolve the theme in a blocking head script, not after paint"
```

---

### Task 5: The toggle

**Files:**
- Create: `components/ThemeToggle.tsx`
- Modify: `app/HomeClient.tsx:1386-1388` (the header's right-hand column)

**Interfaces:**
- Consumes: `Theme`, `THEME_STORAGE_KEY`, `PAPER_CLASS`, `THEME_COLOR`, `resolveTheme`, `nextTheme` from `lib/theme.ts` (Task 1); the `theme-paper` rule from Task 3; the `<meta name="theme-color">` tag created in Task 4.
- Produces: `<ThemeToggle />`, a self-contained client component taking no props.

- [x] **Step 1: Write the component**

Create `components/ThemeToggle.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import {
  type Theme,
  THEME_STORAGE_KEY,
  PAPER_CLASS,
  THEME_COLOR,
  resolveTheme,
  nextTheme,
} from '@/lib/theme';

/**
 * Switches between the Terminal and Paper palettes.
 *
 * The class on <html> is already correct before this mounts (the pre-paint
 * script in app/layout.tsx), so this reads the DOM rather than storage for its
 * initial state — one source of truth, and no chance of rendering a control
 * that disagrees with the page behind it.
 *
 * 36x36, the repo's nib size (see CopyNib.tsx and a dozen siblings).
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('terminal');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(
      document.documentElement.classList.contains(PAPER_CLASS) ? 'paper' : 'terminal',
    );
    setMounted(true);
  }, []);

  function toggle() {
    const to = nextTheme(theme);
    document.documentElement.classList.toggle(PAPER_CLASS, to === 'paper');
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLOR[to]);
    // A blocked or full localStorage must not break the switch itself; the
    // theme still applies, it just will not survive a reload.
    try {
      localStorage.setItem(THEME_STORAGE_KEY, to);
    } catch {
      /* private mode — accept the loss of persistence */
    }
    setTheme(to);
  }

  // Server and first client render must agree, and the server cannot know the
  // stored choice. Render the frame at its final size so the header does not
  // reflow when the icon arrives.
  const label =
    theme === 'paper' ? 'Switch to the dark Terminal theme' : 'Switch to the light Paper theme';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={theme === 'paper'}
      title={label}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-primary active:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {mounted ? (
        theme === 'paper' ? (
          <Moon size={15} aria-hidden />
        ) : (
          <Sun size={15} aria-hidden />
        )
      ) : null}
    </button>
  );
}
```

`resolveTheme` is not called here — the pre-paint script has already applied it — but it stays exported and tested because that script's logic is the same rule, and Task 1's test is what pins it.

- [x] **Step 2: Mount it in the header**

In `app/HomeClient.tsx`, add to the imports:

```ts
import { ThemeToggle } from '@/components/ThemeToggle';
```

Replace lines 1386-1388:

```tsx
          <div className="flex flex-col items-end gap-2 pt-2 shrink-0">
            {mounted && <WalletMenu open={walletOpen} onOpenChange={setWalletOpen} />}
          </div>
```

with:

```tsx
          <div className="flex flex-col items-end gap-2 pt-2 shrink-0">
            <div className="flex items-center gap-1">
              <ThemeToggle />
              {mounted && <WalletMenu open={walletOpen} onOpenChange={setWalletOpen} />}
            </div>
          </div>
```

- [x] **Step 3: Verify the toggle, persistence, and that the header still fits**

With the dev server running, from the scratchpad:

```js
import { chromium } from 'playwright';
const b = await chromium.launch();
for (const [w, h] of [[360, 740], [1440, 900]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } });
  const p = await ctx.newPage();
  await p.goto('http://localhost:3111/', { waitUntil: 'networkidle' });
  const btn = p.getByRole('button', { name: /Switch to the light Paper theme/ });
  const box = await btn.boundingBox();
  console.log(`${w}: toggle ${Math.round(box.width)}x${Math.round(box.height)}`,
    '| aria-pressed', await btn.getAttribute('aria-pressed'),
    '| overflowX', await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  await btn.click();
  await p.waitForTimeout(200);
  console.log(`${w}: after click ->`,
    await p.evaluate(() => document.documentElement.className),
    '| stored', await p.evaluate(() => localStorage.getItem('coinop-theme')),
    '| meta', await p.evaluate(() => document.querySelector('meta[name="theme-color"]').content),
    '| bg', await p.evaluate(() => getComputedStyle(document.body).backgroundColor),
    '| overflowX', await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  await p.reload({ waitUntil: 'networkidle' });
  console.log(`${w}: after reload ->`, await p.evaluate(() => document.documentElement.className));
  await p.screenshot({ path: `/tmp/theme-paper-${w}.png`, fullPage: true });
  await ctx.close();
}
await b.close();
```

Expected at both widths: the toggle measures 36×36; `aria-pressed` starts `false`; after the click the class contains `theme-paper`, storage holds `paper`, the meta is `#F2F0E6`, body background is `rgb(242, 240, 230)`; the class survives the reload; `overflowX` is `0` in both themes at both widths. **If `overflowX` is non-zero at 360 the header is crowded** — move `ThemeToggle` out of the header and into the wallet sheet plus the landing header, per the spec, and amend the spec.

Then open both screenshots and actually look at them.

- [x] **Step 4: Full gate**

Run: `npx tsc --noEmit && pnpm lint && pnpm test:lib`
Expected: all green.

- [x] **Step 5: Commit**

```bash
git add components/ThemeToggle.tsx app/HomeClient.tsx
git commit -m "feat(theme): header toggle between Terminal and Paper"
```

---

### Task 6: RainbowKit follows the theme

This also fixes a defect that ships today: `app/providers.tsx:12-18` still configures RainbowKit with `lightTheme` and the accents `#8B5E2F` / `#F5EBD3` of the parchment identity deleted in `32aedf2`. On the current all-dark build the "Connect a Wallet" modal renders white with system fonts over the phosphor terminal.

**Files:**
- Modify: `app/providers.tsx`

**Interfaces:**
- Consumes: `PAPER_CLASS` from `lib/theme.ts` (Task 1).
- Produces: nothing other tasks import.

- [x] **Step 1: Confirm the defect before changing it**

With the dev server running, from the scratchpad:

```js
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 900, height: 800 } })).newPage();
await p.goto('http://localhost:3111/', { waitUntil: 'networkidle' });
await p.getByRole('button', { name: /sign in/i }).click();
await p.waitForTimeout(2500);
await p.screenshot({ path: '/tmp/rk-before.png' });
await b.close();
```

Look at `/tmp/rk-before.png`. Expected: a white modal over the dark app. That is the bug.

- [x] **Step 2: Make the RainbowKit theme track the app theme**

Replace the theme block in `app/providers.tsx` (the import on line 6 and the `rkTheme` constant on lines 10-18) with:

```tsx
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import { PAPER_CLASS } from '@/lib/theme';
```

```tsx
// RainbowKit renders its own surface, so it has to be told the theme; it does
// not inherit our tokens. Until now it was pinned to lightTheme with the sepia
// accents of the Da Vinci parchment identity deleted in 32aedf2, so the connect
// modal came up white over the phosphor terminal.
const RK = {
  terminal: darkTheme({
    accentColor: '#59F87D',
    accentColorForeground: '#06180C',
    borderRadius: 'medium',
    fontStack: 'system',
    overlayBlur: 'small',
  }),
  paper: lightTheme({
    accentColor: '#0F7A33',
    accentColorForeground: '#FBFAF4',
    borderRadius: 'medium',
    fontStack: 'system',
    overlayBlur: 'small',
  }),
};
```

Inside `Providers`, track the class on `<html>`:

```tsx
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  // The toggle mutates the class on <html> directly, so observe that rather
  // than adding a second source of truth for the current theme.
  const [paper, setPaper] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setPaper(el.classList.contains(PAPER_CLASS));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={paper ? RK.paper : RK.terminal}
          appInfo={{ appName: 'CoinOp' }}
          modalSize="compact"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
```

Add `useEffect` to the existing `react` import on line 3.

- [x] **Step 3: Verify both themes**

From the scratchpad:

```js
import { chromium } from 'playwright';
const b = await chromium.launch();
for (const theme of ['terminal', 'paper']) {
  const ctx = await b.newContext({ viewport: { width: 900, height: 800 } });
  const p = await ctx.newPage();
  if (theme === 'paper') await p.addInitScript(() => localStorage.setItem('coinop-theme', 'paper'));
  await p.goto('http://localhost:3111/', { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /sign in/i }).click();
  await p.waitForTimeout(2500);
  const bg = await p.evaluate(() => {
    const el = document.querySelector('[data-rk] [role="dialog"], [data-rk] div');
    return el ? getComputedStyle(el).backgroundColor : 'not found';
  });
  console.log(`${theme}: modal background ${bg}`);
  await p.screenshot({ path: `/tmp/rk-${theme}.png` });
  await ctx.close();
}
await b.close();
```

Expected: the Terminal modal is dark (not `rgb(255, 255, 255)`), the Paper modal is light. Open both screenshots and confirm each one sits comfortably on its page.

- [x] **Step 4: Full gate**

Run: `npx tsc --noEmit && pnpm lint && pnpm test:lib && pnpm build`
Expected: all green.

- [x] **Step 5: Commit**

```bash
git add app/providers.tsx
git commit -m "fix(wallet): theme the connect modal, which was still parchment-white"
```

---

### Task 7: The pass the token test cannot do

The contrast test covers solid token-on-token pairs. It does not cover **alpha-tinted grounds** — `bg-primary/5`, `bg-money/5`, `bg-primary/10`, `border-l-money`, `bg-destructive/10` and friends composite a token over `--background`, and a tint tuned for a near-black ground can vanish or shout on paper. This task is a human look, with a written result.

**Files:**
- Modify: whichever components the pass finds (expect `ModePicker.tsx`, `AgentTrace.tsx`, `PreviewLocked.tsx`, `WalletMenu.tsx`)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: the finished feature.

- [x] **Step 1: Enumerate the tinted grounds**

Run:

```bash
grep -rnoE '(bg|border|text)-(primary|money|destructive|secondary|accent)/[0-9]+' components app | sort -t: -k3 | uniq -c -f2 | sort -rn
```

Record the list. Each is a place the token test cannot speak for.

- [x] **Step 2: Screenshot every screen in Paper**

With the dev server running, capture at 360×740 in Paper: the landing (pre-connect), the mode picker, one input screen, `PreviewLocked`, `AgentTrace` mid-run, the payoff screen, and `/history` with a row open. Use the mocked MiniPay provider and the stubbed routes from `.claude/skills/verify` for the connected screens; drive `AgentTrace` with a temporary probe page under `app/` (a routable name — Next excludes `_`-prefixed folders) and delete it afterwards.

- [x] **Step 3: Fix what the screenshots show**

Typical repairs, applied only where a screenshot justifies them: raise a `/5` tint to `/10` on paper, or swap a tint for a border. Prefer changing the token alpha at the call site over adding a `theme-paper:` variant — the repo has no such variants and this plan does not introduce them.

- [x] **Step 4: Final verification, both themes, both widths**

Run the Task 5 script again plus a sweep for regressions:

```js
// per theme × per width: no horizontal overflow, no control under 36px
const small = await p.evaluate(() =>
  [...document.querySelectorAll('a,button,[role="button"],input,select,textarea')]
    .map((e) => { const r = e.getBoundingClientRect();
      return { t: (e.textContent || e.getAttribute('aria-label') || e.tagName).trim().slice(0, 34),
               w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((x) => x.h > 0 && x.w > 0 && (x.h < 36 || x.w < 36)));
```

Expected: `overflowX` 0 everywhere, and the only sub-36px control is the 1×1 `Skip to content` link, which is `sr-only` until focused.

- [x] **Step 4b: Confirm the whole suite**

Run: `npx tsc --noEmit && pnpm lint && pnpm test:lib && pnpm build`
Expected: all green.

- [x] **Step 5: Commit**

```bash
git add -u
git commit -m "fix(theme): tune the alpha-tinted grounds the token test cannot cover"
```

Do **not** use `git add -A`: this Desktop is iCloud-synced and produces `name 2.ext` conflict copies.

- [x] **Step 6: Record what is still unverified**

Append to the spec, under Risks: which screens were reviewed in Paper, and that nothing was tested on a real MiniPay device.

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Paper palette, semantics preserved, AA | 3 (values), 2 + 3 (test) |
| Terminal default for unrecognised values | 1 |
| No `prefers-color-scheme` | 1 (never read), enforced by review |
| `:root` unchanged | Global constraint; only the AA defect in Task 2 |
| No flash before first paint | 4 |
| `theme-color` per theme | 4 (tag), 5 (updates), 2 + 3 (asserted against the palette) |
| RainbowKit follows theme, parchment leftover fixed | 6 |
| `.scanlines` token-driven | 3 |
| OG image and icons stay dark | Global constraint; no task edits them |
| Toggle 36×36 in the header, with the sheet fallback | 5 |
| Alpha-tinted grounds need a human pass | 7 |
| `lib/theme.ts` unit tests | 1 |
| Contrast test over `globals.css`, both themes | 2, 3 |
| Playwright: no-flash, round-trip, persistence, meta, overflow | 4, 5, 7 |

No gaps.

**Placeholder scan:** none. Every code step carries the code; the only judgement left to the implementer is Task 7's repairs, which are gated on a screenshot rather than guessed in advance, and the Task 5 fallback, which names its exact trigger (`overflowX` non-zero at 360) and its exact alternative.

**Type consistency:** `Theme`, `THEME_STORAGE_KEY`, `PAPER_CLASS`, `THEME_COLOR`, `resolveTheme`, `nextTheme` are defined in Task 1 and used under those exact names in Tasks 2, 4, 5 and 6. The CSS class string `theme-paper` appears as the literal in `PAPER_CLASS`, in the CSS selector `html.theme-paper` (Task 3), and in the test selector list (Tasks 2, 3) — pinned by the constants test in Task 1.

**One thing the implementer should know:** Task 2 is expected to fail before it passes, and the failure is a real defect in the shipped dark palette, not a mistake in the test. If it does not fail, the test is not reading `globals.css` correctly — investigate rather than proceeding.
