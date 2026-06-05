# Webapp Folio Spread — desktop layout for ShipPost

**Date:** 2026-06-05
**Status:** Design approved, pending implementation plan

## Problem

ShipPost's UI is laid out as a single mobile column (`max-w-md` everywhere). On a
desktop browser it renders as a phone-width strip floating in a wide viewport.
The web *path* already exists at the component level — RainbowKit connect
(`lib/wagmi.ts`), a web title page (`LandingHero.tsx`), a light parchment theme
for web vs dark slate for MiniPay (`ThemeApplicator.tsx`), and `isMiniPay`
branching throughout `HomeClient.tsx` — but the **layout** was never adapted for
wide screens.

## Goal & scope

Make ShipPost look and feel like a proper desktop webapp **while keeping the Celo
$0.05 pay-per-thread flow unchanged**. We are NOT changing onboarding or the
payment path — web users are assumed to already have a Celo-capable wallet.

The MiniPay surface (the competition-judged surface) must keep its current
single-column behaviour **byte-for-byte in terms of UX**. This work is
presentation-only: no change to `usePayForThread`, `useThreadGeneration`,
the refund flow, or any `/api` route.

Desktop gets a **two-page "folio spread"** matching the existing Renaissance-codex
aesthetic: an open book where the **left page = what you asked** and the
**right page = what the agent forged**.

## Approach (chosen: A)

Wrap a responsive layout around the existing `screen` state machine. Considered
and rejected:

- **B — full two-pane controller refactor.** Most flexible long-term but touches
  the most sensitive file (`HomeClient.tsx`, which contains the paid flow) deeply
  and risks regressions right before the competition.
- **C — CSS-only spread, no JS breakpoint.** `AnimatePresence mode="wait"` with a
  single key only renders one screen at a time, so a two-pane layout still needs
  the render restructured to decide what goes where. Ends up no simpler than A.

A is presentation-only: the `screen` state machine stays the single source of
truth; we only change where its output is placed.

## Architecture

### Breakpoint
- New hook `lib/useIsDesktop.ts` — `matchMedia('(min-width: 1024px)')`, SSR-safe
  (returns `false` until mounted, matching the existing `mounted` pattern in
  `HomeClient`). `lg` = 1024px.

### Three render layers in HomeClient (priority order)
1. **Pre-flow states** — not mounted / not connected / wrong network / MiniPay
   connecting / `LandingHero`. **Always a single centered full-width column.**
   The spread does NOT apply here (`LandingHero` is already a complete vertical
   page; these are not the compose flow).
2. **Compose flow on MiniPay or mobile web** (`!isDesktop`) — render exactly as
   today: single column, `AnimatePresence mode="wait"`, screen machine intact.
3. **Compose flow on desktop web** (`!isMiniPay && isDesktop && isConnected &&
   onSupportedChain`) — render the **two-page spread**.

The `!isMiniPay` guard is belt-and-suspenders: a MiniPay webview is narrow so
`isDesktop` is already `false`, but the explicit guard guarantees the judged
surface never enters the new branch.

### Screen categorisation
New `lib/screens.ts` exporting the `Screen` type plus helpers:
```
INPUT  = mode | educational | hot-take
OUTPUT = preview-locked | generating | preview | post-share
isInputScreen(screen) / isOutputScreen(screen)
```

### Structural refactor (presentation-only)
Instead of writing two render trees, compute **one** pair of JSX nodes from the
current `screen` — `inputNode` and `outputNode` — then let layout place them:
- Mobile/MiniPay: place sequentially in one column (only one is non-empty at any
  state → identical to today).
- Desktop: `inputNode` → left page, `outputNode` → right page.

Each pane gets its own `AnimatePresence` keyed by a derived key (left key among
`mode|educational|hot-take|summary`; right key among
`placeholder|preview-locked|generating|preview|post-share`).

## State → pane mapping

| `screen`         | LEFT page (input)        | RIGHT page (output)                                            |
|------------------|--------------------------|----------------------------------------------------------------|
| `mode`           | `ModePicker`             | `RightLeafPlaceholder` ("The right leaf awaits ink")           |
| `educational`    | `EducationalInput`       | `RightLeafPlaceholder`                                          |
| `hot-take`       | `HotTakeInput`           | `RightLeafPlaceholder`                                          |
| `preview-locked` | `ComposeSummary`         | `PreviewLocked`                                                 |
| `generating`     | `ComposeSummary`         | `GeneratingStatus` (+ `ErrorSurface`)                          |
| `preview`        | `ComposeSummary`         | degraded-refund + `ThreadPreview` + `ShareToX` + "I posted it →"|
| `post-share`     | `ComposeSummary`         | `PostShareScreen`                                               |

All conditional logic (`capHit`, `degradedSteps`, `/approve/i` error routing,
`requestRefund`) is unchanged — it just renders inside the right pane on desktop.
`ErrorSurface` and the "Write another" fallback button belong to the
pay/generate outcome → right pane.

## New components

- **`components/ComposeSummary.tsx`** — the only genuinely new piece of product
  UI. A compact read-only "brief" card that replaces the form on the left page
  once submitted, so the left page is never empty during OUTPUT states. Shows:
  mode badge (I/II), topic+audience (mode 0) **or** event+angle (mode 1), and the
  chosen token. No edit affordance — disconnect and "Write another" already reset
  state; keep it minimal (YAGNI).
- **`components/RightLeafPlaceholder.tsx`** — a decorative blank-leaf placeholder
  (faint folio numeral + italic line), parchment-only, non-interactive. Fills the
  right page during INPUT states so the spread isn't lopsided.
- **`components/FolioSpread.tsx`** — presentational layout wrapper that places
  `left`/`right` nodes into the two-page grid with the central spine, keeping
  `HomeClient` readable.

## Header & spine
The header (`ShipPost` title + `WalletMenu` + `FolioMark` + `WalletStatus`) spans
**full width** above both pages, like a book running-head. A **vertical
`InkDivider` (the spine)** sits between the two pages to reinforce the codex
metaphor. Spread container is `~max-w-4xl` centered; each page `~max-w-md` to keep
a readable measure, so ultrawide viewports don't stretch the content.

## Edge cases
- **Resize across the breakpoint mid-flow:** all flow state is lifted into
  HomeClient/hooks (`draftTweets`, `gen`, `screen`), so switching layout only
  re-places nodes — progress is preserved. *Accepted exception:* typing into a
  form and then resizing mobile→desktop re-mounts the form and loses the unsaved
  input (rare; never affects the paid flow).
- **SSR/hydration:** `useIsDesktop()` returns `false` until mount → server and
  first paint render the single column, then upgrade to the spread. Matches the
  existing `mounted` flash pattern; no new flash introduced.

## Testing
- **`pnpm test:lib` must stay green** — because no pay/generate/refund logic
  changes, the existing suite is the no-regression evidence.
- New unit tests:
  - `lib/screens.ts` — `isInputScreen` / `isOutputScreen` mapping.
  - `ComposeSummary` — renders correctly for both mode 0 and mode 1.
  - `useIsDesktop` — with `matchMedia` mocked.
- Manual checks: desktop → spread; narrow the browser → single column; mock
  `isMiniPay` → single dark column, unchanged.

## Files
- *New:* `lib/useIsDesktop.ts` (+test) · `lib/screens.ts` (+test) ·
  `components/ComposeSummary.tsx` (+test) · `components/FolioSpread.tsx` ·
  `components/RightLeafPlaceholder.tsx`
- *Changed:* `app/HomeClient.tsx` — extract `inputNode`/`outputNode`, add the
  layout branch. No changes to `usePayForThread`, `useThreadGeneration`, or the
  refund path.

## Non-goals (explicitly out of scope)
- Onboarding / payment path changes for web users without a Celo wallet.
- New web user acquisition, marketing landing pages, SEO/OG work.
- Web affordances beyond layout (hover polish, keyboard shortcuts) — may be
  follow-ups, not part of this spec.
