# Input Form Codex Redesign

**Date:** 2026-05-12  
**Scope:** `EducationalInput.tsx`, `HotTakeInput.tsx`  
**Goal:** Bring both input forms to visual parity with `ModePicker` and `LandingHero` — full "Codex of Threads" aesthetic.

---

## Problem

`EducationalInput` and `HotTakeInput` use a plain `Card` wrapper with generic form elements (`text-lg font-semibold`, bare `Label`, basic `RadioGroup`). They break the codex aesthetic established by every other page: no `font-display italic`, no `InkDivider`, no `Marginalia`, no reveal animations, no Roman numeral section headers.

---

## Approach: Full Codex Folio (Approach A)

Rebuild both forms to match the "folio page" pattern. No new shared wrapper component — the two forms are the only consumers and a shared abstraction adds complexity without benefit.

---

## Section 1: Layout & Header

**Container:** Replace `Card` with `section className="w-full max-w-md flex flex-col gap-4"` — same as `ModePicker`.

**Back link** (top of form):
- Text: `← Folio I · Modes`
- Style: `heading-sub text-[10px]` + `ArrowLeft size={12}`
- Behavior: unchanged (`onBack` prop)

**Header block** (replaces `h2 className="text-lg font-semibold"`):

```
[heading-sub · 10px]        "Folio I · Educational Thread"   (or "Folio II · Hot Take")
[font-display italic · 2xl] "Set the quill"                  ← InkText animated, delay=50
[italic muted · sm]         "Describe the concept and the reader."
```

Inline with the title text: Roman numeral (I / II) + `CodexFrame` + `IllumIcon` in a `w-16 h-16` block — scaled down from ModePicker's `w-24 h-24`.

- Educational: numeral `I`, icon `IllumGraduationCap`
- Hot Take: numeral `II`, icon `IllumFlame`

`InkDivider` below the header block.

---

## Section 2: Form Fields

Each field group uses `heading-sub text-[10px]` as its label (instead of `Label` component) with `InkDivider` separating sections.

### EducationalInput

**I · Topic**
```
[heading-sub]  "I · Topic"
[InkDivider]
[Input]  id="topic", placeholder unchanged
```

**II · Audience** — toggle chips (pill buttons, not RadioGroup):
```
[heading-sub]  "II · Audience"
[InkDivider]
[ Beginner ] [ Intermediate ] [ Advanced ]
```
Chip styles:
- Default: `border border-[hsl(var(--ink-faded))] text-muted-foreground rounded-full px-3 py-1 text-xs`
- Active: `border-primary text-primary bg-primary/10`
- Implemented as `<button type="button">` elements, state managed with `useState`

### HotTakeInput

**I · Event**
```
[heading-sub]  "I · Event"
[InkDivider]
[Textarea rows=3]  placeholder unchanged
[font-mono text-xs muted]  "{trimmedLen}/600"
[UrlPreviewCard]  — rendered when URL detected (unchanged)
```

**II · Angle** — same toggle chip pattern:
```
[heading-sub]  "II · Angle"
[InkDivider]
[ Bullish ] [ Bearish ] [ Skeptical ]
```

### Token section (both forms)

`TokenSelector` component is unchanged. Add above it:
```
[heading-sub]  "III · Token"
[InkDivider]
[TokenSelector]
[Marginalia side="right"]  contextual note (see below)
```

`Marginalia` notes:
- Educational: *"highest balance pre-selected"*
- Hot Take: *"same cost either angle"*

Loading state (`isLoading`): keep existing `Loader2` spinner, styled with `text-[hsl(var(--ink-faded))]`.

---

## Section 3: Submit Button & Animations

**Cost row** — added between TokenSelector and Button, using leader-dot rhythm:

```
You pay ················· 0.05 cUSD
```

Markup pattern (same as `LedgerLine` in `LandingHero`):
- Left: `text-[11px] italic text-muted-foreground` — "You pay"
- Middle: `flex-1 border-b border-dotted border-[hsl(var(--ink-faded))] mb-1 opacity-50`
- Right: `font-mono text-[11px] text-[hsl(var(--ink-faded))]` — `"{amountStr} {symbol}"`
- Hidden when `effectiveToken` is null

**Button:** No change to `Button` component or text (`Generate for X.XX TOKEN →`).

**Animations** — `form-reveal` keyframe, staggered per block:

```css
@keyframes form-reveal {
  0%   { opacity: 0; transform: translateY(10px); filter: blur(1.5px); }
  100% { opacity: 1; transform: translateY(0);    filter: blur(0); }
}
```

| Block | Delay |
|---|---|
| Header (numeral + title) | 0s |
| Field I (Topic / Event) | 0.10s |
| Field II (Audience / Angle) | 0.20s |
| Token section | 0.30s |
| Cost row + Button | 0.40s |

`prefers-reduced-motion`: `animation-duration: 0.01ms; animation-delay: 0ms` (same pattern as `LandingHero`).

---

## Files Changed

| File | Change |
|---|---|
| `components/EducationalInput.tsx` | Full redesign per spec |
| `components/HotTakeInput.tsx` | Full redesign per spec |

No new files. No shared wrapper. `RadioGroup` and `RadioGroupItem` imports removed from both files (replaced by `<button>` chips). `Label` import removed (replaced by `heading-sub` spans).

---

## Constraints

- Mobile-only — no desktop layout needed
- Dark mode default (MiniPay webview) — all color tokens use CSS vars, no hardcoded colors
- Bundle budget unchanged — no new dependencies
- Props interface (`onSubmit`, `onBack`, `disabled`) unchanged — `HomeClient.tsx` not touched
