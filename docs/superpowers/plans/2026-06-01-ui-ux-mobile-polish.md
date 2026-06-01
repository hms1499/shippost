# UI/UX Mobile Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add four mobile/MiniPay UX improvements — haptics, safe-area insets, bottom-sheet scroll-lock, and dynamic theme-color — without touching the design system.

**Architecture:** Two new testable `lib/` modules (`haptics.ts`, `useBodyScrollLock.ts`), each a pure core + thin wrapper, plus targeted edits to existing files following current patterns. No new dependencies (framer-motion already present).

**Tech Stack:** Next.js 14, React 18, TypeScript, Tailwind, Vitest (node env, no jsdom — tests stub globals via `vi.stubGlobal`).

**Spec:** `docs/superpowers/specs/2026-06-01-ui-ux-mobile-polish-design.md`

---

## Notes for all tasks

- **No dependency changes** — so no `pnpm add`, no lockfile churn.
- **Uncommitted WIP:** `package.json` and `scripts/withdraw-agent.ts` have unrelated WIP. No task here touches them. **Always `git add` the exact files listed — never `git add -A`.**
- **Safe-area refinement vs spec:** the spec described `.safe-b/.safe-t` utility classes. Both edge-anchored sites (the main container and the bottom sheet) already have base padding, so we use Tailwind arbitrary `calc(... + env(safe-area-inset-*))` values inline instead — same outcome, no unused CSS. `env()` resolves to `0` on non-notched devices, so these are no-ops there.

---

### Task 1: `lib/haptics.ts` (TDD)

**Files:**
- Create: `lib/haptics.ts`
- Test: `lib/haptics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/haptics.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { haptic } from './haptics';

const vibrate = vi.fn();

// node-env vitest has no window/navigator; stub them per test.
function setup(opts: { vibrate?: typeof vibrate; reduce: boolean }) {
  vi.stubGlobal('navigator', opts.vibrate ? { vibrate: opts.vibrate } : {});
  vi.stubGlobal('window', {
    matchMedia: vi.fn(() => ({ matches: opts.reduce })),
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('haptic', () => {
  it('vibrates with the tap pattern when supported and motion allowed', () => {
    setup({ vibrate, reduce: false });
    haptic('tap');
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it('uses array patterns for success and error', () => {
    setup({ vibrate, reduce: false });
    haptic('success');
    expect(vibrate).toHaveBeenCalledWith([12, 40, 18]);
    haptic('error');
    expect(vibrate).toHaveBeenCalledWith([30, 40, 30]);
  });

  it('no-ops when vibrate is unsupported', () => {
    setup({ reduce: false }); // navigator has no vibrate
    haptic('tap');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('no-ops when reduced motion is set', () => {
    setup({ vibrate, reduce: true });
    haptic('error');
    expect(vibrate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:lib`
Expected: FAIL — cannot resolve `./haptics`.

- [ ] **Step 3: Write the implementation**

Create `lib/haptics.ts`:
```ts
export type HapticKind = 'tap' | 'success' | 'error' | 'tick';

// Vibration patterns in ms. Single number = one buzz; array = buzz/pause/buzz.
const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  tick: 8,
  success: [12, 40, 18],
  error: [30, 40, 30],
};

// Fire a short haptic at a meaningful interaction moment. No-ops where the
// Vibration API is absent (notably iOS Safari/webview) and when the user has
// asked for reduced motion. Safe to call during SSR.
export function haptic(kind: HapticKind): void {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  navigator.vibrate(PATTERNS[kind]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:lib`
Expected: PASS — haptic cases green plus existing suites.

- [ ] **Step 5: Commit**

```bash
git add lib/haptics.ts lib/haptics.test.ts
git commit -m "feat(haptics): add reduced-motion-aware vibration helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire haptics into the flow

**Files:**
- Modify: `lib/usePayForThread.ts`
- Modify: `hooks/useThreadGeneration.ts`
- Modify: `components/ShareToX.tsx`

- [ ] **Step 1: Import and fire in `usePayForThread.ts`**

Add the import after the existing local imports near the top (it sits beside other `./` imports):
```ts
import { haptic } from './haptics';
```
Then add three calls. After `setStatus('paying');`:
```ts
        setStatus('paying');
        haptic('tap');
```
After `setStatus('success');`:
```ts
        setStatus('success');
        haptic('success');
```
In the **final `catch (e)` block** at the end of `pay` (where `msg` is derived
from the caught error), after `setStatus('error');`:
```ts
        setError(msg);
        setStatus('error');
        haptic('error');
```
**Important:** `pay` has several earlier `setStatus('error')` validation guards
(no wallet, wrong network, wallet-client-not-ready, chain-switch failures). Do
NOT add `haptic('error')` to those — only to the single `catch (e)` block at the
end, which is the actual payment-failure path. Identify it by the preceding
`const msg = (e as ...)` assignment.

- [ ] **Step 2: Import and fire in `hooks/useThreadGeneration.ts`**

Add the import:
```ts
import { haptic } from '@/lib/haptics';
```
Change the terminal-event branch (currently `if (e.type === 'done' || e.type === 'fatal') { clearSlowTimer(); }`) to:
```ts
    if (e.type === 'done' || e.type === 'fatal') {
      clearSlowTimer();
      haptic(e.type === 'done' ? 'success' : 'error');
    } else if (
```

- [ ] **Step 3: Import and fire in `components/ShareToX.tsx`**

Add the import:
```ts
import { haptic } from '@/lib/haptics';
```
In `copyAll`, after `setCopied(true);`:
```ts
      setCopied(true);
      haptic('tick');
```

- [ ] **Step 4: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add lib/usePayForThread.ts hooks/useThreadGeneration.ts components/ShareToX.tsx
git commit -m "feat(haptics): buzz on pay, generation result, and copy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `lib/useBodyScrollLock.ts` (TDD)

**Files:**
- Create: `lib/useBodyScrollLock.ts`
- Test: `lib/useBodyScrollLock.test.ts`

- [ ] **Step 1: Write the failing test**

Create `lib/useBodyScrollLock.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { setBodyScrollLocked } from './useBodyScrollLock';

afterEach(() => vi.unstubAllGlobals());

function stubBody() {
  const body = { style: { overflow: '' } };
  vi.stubGlobal('document', { body });
  return body;
}

describe('setBodyScrollLocked', () => {
  it('sets overflow hidden when locked', () => {
    const body = stubBody();
    setBodyScrollLocked(true);
    expect(body.style.overflow).toBe('hidden');
  });

  it('clears overflow when unlocked', () => {
    const body = stubBody();
    body.style.overflow = 'hidden';
    setBodyScrollLocked(false);
    expect(body.style.overflow).toBe('');
  });

  it('is a no-op during SSR (no document)', () => {
    vi.stubGlobal('document', undefined);
    expect(() => setBodyScrollLocked(true)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:lib`
Expected: FAIL — cannot resolve `./useBodyScrollLock`.

- [ ] **Step 3: Write the implementation**

Create `lib/useBodyScrollLock.ts`:
```ts
import { useEffect } from 'react';

// Pure, SSR-safe body-scroll toggle. Setting overflow to '' on unlock reverts to
// the stylesheet default (body has no inline overflow otherwise). Stateless, so
// it's trivially testable and safe for the app's single bottom sheet.
export function setBodyScrollLocked(locked: boolean): void {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = locked ? 'hidden' : '';
}

// Lock background scroll while `locked` is true; always release on unmount.
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    setBodyScrollLocked(locked);
    return () => setBodyScrollLocked(false);
  }, [locked]);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/useBodyScrollLock.ts lib/useBodyScrollLock.test.ts
git commit -m "feat(sheet): add body scroll-lock hook

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Bottom sheet — scroll-lock, focus, safe-area

**Files:**
- Modify: `components/WalletMenu.tsx`

- [ ] **Step 1: Ensure React imports include `useEffect` and `useRef`**

At the top of `components/WalletMenu.tsx`, make sure the `react` import includes `useEffect` and `useRef` (add whichever are missing), e.g.:
```ts
import { useEffect, useRef, useState } from 'react';
```
Add the hook import:
```ts
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
```

- [ ] **Step 2: Add scroll-lock + focus management**

Find the `const [open, setOpen] = useState(false)` declaration. Immediately after it, add:
```ts
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useBodyScrollLock(open);

  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => closeBtnRef.current?.focus());
    } else {
      lastFocusedRef.current?.focus?.();
    }
  }, [open]);
```

- [ ] **Step 3: Attach the ref to the close button**

On the existing close `<button>` (the one with `aria-label="Close menu"`), add `ref={closeBtnRef}`:
```tsx
                        <button
                          ref={closeBtnRef}
                          type="button"
                          onClick={() => setOpen(false)}
                          aria-label="Close menu"
```

- [ ] **Step 4: Add safe-area padding to the sheet**

On the sheet's inner container (`<div className="w-full max-w-md mx-auto px-6 pt-3 pb-6 flex flex-col gap-4">`), change `pb-6` to a safe-area-aware value:
```tsx
                    <div className="w-full max-w-md mx-auto px-6 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex flex-col gap-4">
```

- [ ] **Step 5: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add components/WalletMenu.tsx
git commit -m "feat(sheet): scroll-lock, focus management, safe-area inset

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Safe-area on the main container

**Files:**
- Modify: `app/HomeClient.tsx`

- [ ] **Step 1: Add top + bottom safe-area to `<main>`**

Find the main wrapper:
```tsx
    <main className="relative min-h-screen flex flex-col items-center gap-6 p-6 pt-10">
```
Replace `p-6 pt-10` with explicit per-edge padding that folds in the safe-area insets (keeps the existing 24px horizontal, 40px top, 24px bottom bases):
```tsx
    <main className="relative min-h-screen flex flex-col items-center gap-6 px-6 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add app/HomeClient.tsx
git commit -m "feat(layout): respect safe-area insets on the main container

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Dynamic theme-color

**Files:**
- Modify: `components/ThemeApplicator.tsx`

- [ ] **Step 1: Update the theme-color meta when dark is applied**

Replace the body of the `useEffect` in `components/ThemeApplicator.tsx` so that, when MiniPay/dark is active, the `<meta name="theme-color">` is updated to the dark slate (`#0f1729` = `hsl(222 47% 11%)`):
```tsx
  useEffect(() => {
    const eth = (window as unknown as { ethereum?: { isMiniPay?: boolean } })
      .ethereum;
    if (eth?.isMiniPay) {
      document.documentElement.classList.add('dark');
      // Match the mobile status-bar tint to the slate theme. Dark is forced by
      // class here (not prefers-color-scheme), so a media-query theme-color
      // wouldn't track it — update the meta tag directly.
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', '#0f1729');
    }
  }, []);
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add components/ThemeApplicator.tsx
git commit -m "feat(theme): sync mobile theme-color with the dark MiniPay theme

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Full verification gate

No code changes — confirm everything is green.

- [ ] **Step 1: Lint** — Run: `pnpm lint` → Expected: exit 0, no errors.
- [ ] **Step 2: Typecheck** — Run: `npx tsc --noEmit` → Expected: exit 0.
- [ ] **Step 3: Library tests** — Run: `pnpm test:lib` → Expected: all pass, including new haptics + scroll-lock cases.
- [ ] **Step 4: Build** — Run: `pnpm build` → Expected: `✓ Compiled successfully`, full route table (the `@metamask/sdk` "Module not found: async-storage" warning is pre-existing and unrelated).
- [ ] **Step 5: No stray changes** — Run: `git status --short` → Expected: only the pre-existing WIP (` M package.json`, ` M scripts/withdraw-agent.ts`) remains uncommitted.
