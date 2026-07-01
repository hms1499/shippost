# Hook Engine + Banned-phrase Highlight

**Date:** 2026-07-01
**Status:** Approved (design)
**Persona this serves:** web3 content creator optimising for reach (not just credibility)

## Problem

The generation prompts optimise for a neutral, anti-hype "senior engineer" voice.
That is excellent for *credibility* but works against a content creator's job,
which is *engagement*. Two concrete drags on reach:

1. **Hooks are actively suppressed.** `system.ts` and every mode structure ban
   question openers and force a flat, plain tweet 1 ("name the event, not a
   mood"). Tweet 1 decides ~90% of a thread's reach; a deliberately flat opener
   leaves reach on the table.
2. **The anti-slop ban list is unenforced and invisible.** `system.ts:9-16`
   lists banned phrases as "auto-fail if any appear", but nothing in code checks
   them — `threadParser.ts` only splits paragraphs and caps tweet count. When the
   model leaks "delve" / "massive" / "game changer", the creator has no signal.

Separately, the product treats each tweet as capped at 270 characters. For a
creator (X Premium posts long-form), that cap is artificial and is being dropped.

## Goals

- Enable strong, engaging hooks on tweet 1 across all four modes — **without**
  reopening the door to AI slop.
- Make the existing ban list *visible* to the creator so they can self-fix
  leaked slop, live, while editing.
- Drop the 270-character constraint end to end (generation + UI).

## Non-goals (explicitly cut in brainstorming — YAGNI)

- No interactive "pick your hook" step. Hook is baked into the single existing
  Groq call; no flow/UX/cost change.
- No character clamp. Tweets may be any length.
- No auto-editing or regeneration of banned phrases. Detection is **flag-only**;
  the creator decides.
- No changes to SSE / the `/api/generate/stream` route / the pipeline / payments.

## Design

### Part 1 — Hook Engine (prompt-only)

**`lib/prompts/system.ts`**

- Add a new `HOOK (tweet 1 only)` block under `VOICE`. It permits four hook
  shapes: a hard number, a contradiction/tension, a stake, or a *specific*
  unanswered question. The hook must **carry** a fact, never merely tease one. A
  rhetorical throat-clear ("Ever wondered…") stays banned.
- **Remove** line 20: `- Each tweet at most 270 characters (X reply indicator
  eats the rest).`
- The `DO NOT WRITE` ban list is kept **verbatim**. Hooks are loosened at the
  level of opener *structure* only; no banned word becomes allowed.

**Four mode files** — replace the "No question opener" instruction on tweet 1:

| File | Change |
|---|---|
| `lib/prompts/modeA.ts` (T1) | Allow a hook: a hard specific or a real unanswered question about the concept. |
| `lib/prompts/modeB.ts` (T1) | Hook framing the event through its sharpest verifiable fact/tension. Keep "no angle adjectives". |
| `lib/prompts/tokenAnalysis.ts` (T1) | Hook naming the token through its most striking real number/contradiction. Keep "no angle adjectives". |
| `lib/prompts/dailyRecap.ts` (T1) | Allow a sharp *neutral* question hook. Keep "name the event, not a mood"; keep the GM/Today/In this thread bans. |

**Guardrails intentionally kept:**
- Mode B / Token bodies stay directionally neutral until the closing tweet
  ("no angle adjectives"). Reach is not bought by turning the whole thread into a
  shill.
- Daily Recap keeps its Bloomberg-style "event, not a mood" rule; only a neutral
  question opener is unlocked.

### Part 2 — Banned-phrase Highlight (client-only)

Detection runs **client-side and live**, not as a server-emitted snapshot,
because `ThreadPreview.tsx` lets the creator edit each tweet in place. A one-shot
server flag would go stale the moment they edit; live client detection updates as
they type. The ban list is not secret (it already ships inside the prompt), so
moving it client-side is safe.

**`lib/bannedPhrases.ts` (new)** — single source of truth:
- The ban list as structured data (phrase + group: `slop-opener` |
  `hype-adjective` | `marketing` | `cta-filler`), extracted from the prose
  currently inlined in `system.ts`.
- `detectBannedPhrases(text: string): Match[]` — a pure function returning matched
  spans (`{ start, end, phrase, group }`), word-boundary + case-insensitive.
- `system.ts` imports this list and renders it into the `DO NOT WRITE` block, so
  the prompt and the highlighter can never drift apart.

**`components/ThreadPreview.tsx`:**
- Highlight matched phrases inline by wrapping them in `<mark>` (vermillion
  underline + a tooltip naming the group, e.g. "hype adjective — cut or
  replace"). Computed via `useMemo` per leaf so it tracks edits.
- **Remove** the 270-based UI entirely: `MAX_TWEET_LEN`, `over`, `ratio`, the
  `{len}/270` counter, the `InkMeter` component, and the "X will split this leaf"
  warning.

## Data flow

Unchanged from today. The pipeline still emits
`{ type: 'step_output', step: 'groq', output: { final: true, tweets } }`. No new
SSE fields, no route changes. Banned-phrase detection is a pure client render-time
computation over `tweets`.

## Files touched

- `lib/prompts/system.ts` — add HOOK block, drop 270 line, source ban list from new module.
- `lib/prompts/modeA.ts`, `modeB.ts`, `tokenAnalysis.ts`, `dailyRecap.ts` — hook instruction on T1.
- `lib/bannedPhrases.ts` — **new** module (data + `detectBannedPhrases`).
- `components/ThreadPreview.tsx` — inline highlight; remove 270 UI.

Confirmed by grep: the only non-cosmetic `270` / `MAX_TWEET_LEN` references are
`system.ts:20` and `ThreadPreview.tsx` (lines 12, 112, 113, 305).
`components/ui/card.tsx:25` uses `rotate={270}` (unrelated). No test references.

## Testing

- `lib/bannedPhrases.test.ts` (new, Vitest): `detectBannedPhrases` matches on word
  boundaries (does not flag "delver" for "delve"), is case-insensitive, returns
  correct spans, handles multiple matches per string, and returns empty for clean
  text.
- Manually verify in the app: a generated thread renders; typing a banned word in
  the editor highlights it live; deleting it clears the highlight; tweets longer
  than 270 chars render without a warning or counter.
- `pnpm test:lib` and `pnpm lint` green.

## Risk

Loosening hooks while the ban list is unenforced server-side means the model can
still drift toward slop hooks. That is exactly what Part 2 catches: the highlight
is the guard that pairs with the loosened gate. The two parts ship together.
