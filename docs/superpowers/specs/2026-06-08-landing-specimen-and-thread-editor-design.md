# Landing specimen + thread editor delete/reorder — design

Date: 2026-06-08
Status: approved

## Goal

Two UX-driven changes from the design review:

1. **Show, don't tell** on the pre-connect landing — exhibit a real sample
   thread so a first-time user sees output quality before connecting a wallet.
2. **Delete + reorder** in the thread editor — let users drop and rearrange
   tweets, not just edit their text.

Both target the actual MiniPay user base (mobile-first, conversion under
real-money friction).

## A. Landing specimen (`components/LandingHero.tsx`)

- **Source:** a curated, hardcoded sample lives in `lib/sampleThread.ts`,
  exporting `{ firstTweet: string; total: number }`. One mode only — Hot Take
  (it shows off the most: live data + fact-check voice). Hardcoded so it always
  reads well, never depends on an API, and stores no PII.
- **Placement:** a new section *"Specimen · A finished leaf"* inserted **after
  the Synopsis (Folio 0) and before the Index Modorum (Modes)** — output before
  mechanics.
- **Visual:** reuse `PreviewLocked`'s vocabulary — the opening tweet in a full
  `Card`, then 2–3 blurred locked cards with a "N more tweets" lock badge. This
  is a **read-only exhibit**: no Unlock/Regenerate buttons. The existing
  "Take up the quill" CTA below remains the only action.
- **Motion:** extend the existing `reveal` cadence with one more delay step;
  honors `prefers-reduced-motion` via the existing rule.

## B. Editor delete + reorder (`components/ThreadPreview.tsx`)

- **Pure helpers** in `lib/threadEdits.ts` (unit-tested, TDD):
  - `moveTweet(tweets: string[], index: number, dir: -1 | 1): string[]`
    — returns a new array with the item swapped up/down; returns the input
    unchanged if the move is out of bounds.
  - `deleteTweet(tweets: string[], index: number): string[]`
    — returns a new array without `index`; returns the input unchanged if it
    would empty the array (last tweet is protected) or index is out of range.
- **Controls** added to each `FolioLeaf` header row, beside the edit nib: **↑**,
  **↓**, **🗑**.
  - `↑` disabled on the first leaf; `↓` disabled on the last leaf.
  - `🗑` disabled when only one tweet remains (no empty thread).
- **Editing interplay:** reorder/delete controls are **hidden while any leaf's
  editor is open** (mirrors how the edit nib already swaps to cancel). This
  avoids index drift between `editingIdx` and a reordered/deleted array. Roman
  numerals and the first-leaf drop-cap recompute from position automatically.
- **Tap targets:** each control gets ~36–40px hit area via padding while the
  icon stays visually small — also resolves the small-tap-target note from the
  review.
- **Accessibility:** `aria-label`s — "move up", "move down", "delete tweet".

## C. Out of scope

- **"Copy all"** — already implemented in `components/ShareToX.tsx`
  (`copyAll`, "Copy all N tweets"), rendered directly below `ThreadPreview` on
  the preview screen. Not duplicated.

## Testing

- Vitest over `lib/threadEdits.ts` (bounds, last-tweet guard, immutability).
- `pnpm build` + `pnpm lint` green.
- Playwright screenshots: landing (light + dark) showing the specimen; editor
  with reorder/delete controls.

## Files touched

- `lib/sampleThread.ts` (new)
- `lib/threadEdits.ts` (new) + `lib/threadEdits.test.ts` (new)
- `components/LandingHero.tsx`
- `components/ThreadPreview.tsx`
