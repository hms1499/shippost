# UI/UX mobile polish package — design

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan

## Context

ShipPost is a mobile-only MiniApp running inside Opera's MiniPay webview (dark
mode forced via a `.dark` class set by `ThemeApplicator`; light "codex
parchment" theme on web). The UI is already high-craft: a distinctive
illuminated-manuscript design system, `components/motion/` wrappers using
`useReducedMotion`, `prefers-reduced-motion` handling in CSS, focus-visible
rings, 44px touch targets, and skeleton states. This package adds four targeted
mobile-fit improvements without touching the design system or aesthetic.

Generic UI suggestions (add framer-motion, hover effects, a Cmd+K command
palette) are explicitly out of scope: motion is already in place and the app is
mobile/touch-only with no keyboard.

## Items

### 1. Safe-area insets

**Problem:** `app/layout.tsx` sets `viewport.viewportFit = 'cover'` (content
renders edge-to-edge under the notch / home indicator), but no code consumes
`env(safe-area-inset-*)`. The fixed bottom sheet (`components/WalletMenu.tsx`,
`fixed bottom-0`, inner `pb-6`) can sit under the iOS home indicator, and
edge-anchored content can be clipped.

**Design:**
- Add utilities in `globals.css` `@layer utilities`:
  `.safe-b { padding-bottom: env(safe-area-inset-bottom); }` and
  `.safe-t { padding-top: env(safe-area-inset-top); }`.
- Bottom sheet inner container (`WalletMenu.tsx` ~line 208): change `pb-6` to
  `pb-[calc(1.5rem+env(safe-area-inset-bottom))]` — keeps the 24px base and adds
  the inset.
- `HomeClient` main scroll container and the top bar (`WalletStatus`, if
  top-anchored) get `safe-b` / `safe-t` as appropriate.

**Verification:** `pnpm build` passes; correctness reasoned about (pixel-level
safe-area cannot be asserted headlessly — the spec documents the assumption that
`env()` resolves to 0 on non-notched devices, so the change is a no-op there).

### 2. Haptics

**Problem:** No tactile feedback anywhere in a tap-driven payment flow.

**Design:** New `lib/haptics.ts` exporting
`haptic(kind: 'tap' | 'success' | 'error' | 'tick'): void`:
- Patterns: `tap = 10`, `tick = 8`, `success = [12, 40, 18]`, `error = [30, 40, 30]` (ms).
- SSR-safe: guard `typeof navigator === 'undefined'`.
- Feature-detect `navigator.vibrate` (absent → no-op).
- Respect reduced motion: if `window.matchMedia('(prefers-reduced-motion: reduce)').matches`, no-op.
- **Caveat (documented, not a bug):** iOS Safari/webview does not implement the
  Vibration API, so haptics is a no-op on iOS; it works on Android (MiniPay's
  primary platform). Progressive enhancement.

**Wiring (meaningful moments only, not every tap):**
- `lib/usePayForThread.ts`: `tap` when the user submits the pay tx; `success`
  when the receipt confirms; `error` on the error branch.
- `hooks/useThreadGeneration.ts`: `success` when the thread is ready (done).
- `components/ShareToX.tsx`: `tick` on successful copy-to-clipboard.

**Testing:** `lib/haptics.test.ts` (vitest) mocking `navigator.vibrate` and
`window.matchMedia`: fires the right pattern when supported and motion is
allowed; no-ops when `vibrate` is absent; no-ops when reduced motion is set.

### 3. Body scroll-lock for the bottom sheet

**Problem:** When the `WalletMenu` sheet is open, the background page still
scrolls (scroll bleed) — a common mobile-sheet flaw. The sheet already has
`role="dialog"` + `aria-modal="true"` + backdrop-to-close.

**Design:** New `lib/useBodyScrollLock.ts` exporting
`useBodyScrollLock(locked: boolean): void` — when `locked`, sets
`document.body.style.overflow = 'hidden'` and restores the previous value on
unlock/unmount (SSR-safe). Use it in `WalletMenu` keyed on `open`. Add light
focus management: focus the close button (or dialog) on open, return focus to
the trigger on close.

**Testing:** The repo's vitest runs in a node environment with no jsdom and no
React Testing Library (existing tests are all pure functions). So: extract a
pure `setBodyScrollLocked(locked: boolean)` function (reads/writes
`document.body.style.overflow`, remembering the prior value to restore) into
`lib/useBodyScrollLock.ts`; the `useBodyScrollLock` hook is a thin `useEffect`
wrapper over it. `lib/useBodyScrollLock.test.ts` unit-tests the pure function by
stubbing a fake `globalThis.document`, asserting `overflow` becomes `hidden`
when locked and the prior value is restored on unlock. The hook wrapper itself
is not separately tested (no harness).

### 4. Dynamic theme-color

**Problem:** `app/layout.tsx` `viewport.themeColor` is a static
`#ede3ce` (light parchment), but MiniPay forces dark via the `.dark` class set
by `ThemeApplicator` — independent of `prefers-color-scheme`, so a media-query
theme-color would not track the real theme. The mobile status bar/chrome tints
to the wrong (light) color in MiniPay.

**Design:** Keep the light default in `layout.tsx`. In
`components/ThemeApplicator.tsx`, when the dark class is applied, update (or
insert) `<meta name="theme-color" content="#0f1729">` — `#0f1729` is the dark
slate background `hsl(222 47% 11%)` converted to hex. On the light path, leave
the default `#ede3ce`.

**Testing:** Reasoned + `pnpm build`; the meta mutation is a small DOM side
effect verified by reading the resulting code, not a unit test.

## Architecture

Two new testable modules — `lib/haptics.ts`, `lib/useBodyScrollLock.ts` — each
with one clear responsibility and a unit test. The rest are targeted edits to
existing files following current patterns. No design-system or aesthetic
changes.

## Files touched

- `app/globals.css` — safe-area utilities
- `components/WalletMenu.tsx` — sheet safe-area padding, scroll-lock, focus mgmt
- `app/HomeClient.tsx` (and `components/WalletStatus.tsx` if top-anchored) — safe-area
- `lib/haptics.ts` + `lib/haptics.test.ts` — new
- `lib/useBodyScrollLock.ts` + `lib/useBodyScrollLock.test.ts` — new
- `lib/usePayForThread.ts`, `hooks/useThreadGeneration.ts`, `components/ShareToX.tsx` — haptics wiring
- `components/ThemeApplicator.tsx` — dynamic theme-color

## Non-goals (YAGNI)

- Full focus-trap library; haptics on every interaction; any design-system
  refactor; desktop-specific patterns (command palette, keyboard shortcuts).

## Verification

`pnpm lint`, `npx tsc --noEmit`, `pnpm test:lib` (incl. new haptics +
scroll-lock tests), and `pnpm build` all green. Safe-area and theme-color are
reasoned about + build-verified (not unit-testable headlessly).
