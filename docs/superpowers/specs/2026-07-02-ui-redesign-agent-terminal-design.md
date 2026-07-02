# UI Redesign — Agent Terminal

**Date:** 2026-07-02
**Status:** Approved (brainstorm with visual companion)
**Scope:** Full visual redesign of ShipPost — every screen, one theme. Replaces the Da Vinci codex/parchment aesthetic.

## Motivation

- The codex aesthetic no longer fits a crypto/AI product and has run its course.
- Proof of Ship (AI Agents track) judging is < 1 week away; the UI should impress and *explain* the product.
- The real differentiator — an ERC-8004 agent wallet making x402 micro-payments to AI services — is currently invisible in the UI. The redesign makes it the visual centerpiece.

## Direction

**Agent Terminal**: a dark phosphor-green console where the agent's work (per-service x402 payments, pipeline progress, settle gating) is rendered as a live trace. Chosen over Fintech Dark, Neo-brutalist, and AI Glow alternatives.

**Approach:** Retheme via design tokens + one new hero screen. Keep all logic, flows, and API contracts untouched. No changes under `/api/generate`, `lib/pipeline/`, or contracts.

## Design System

### Color tokens (replace both existing themes; single dark theme everywhere, including web landing)

| Token | Value | Role |
|---|---|---|
| `bg` | `#0A0D0A` | near-black, green-tinted (phosphor CRT) |
| `surface` | `#111611` | cards, inputs |
| `border` | `#22331F` | soft borders |
| `primary` | `#59F87D` | actions, agent activity, success |
| `money` | `#FFC247` | **every $ amount in the app** — payments, spend caps, prices |
| `error` | `#FF5C5C` | errors, refund states |
| `text` | `#E8F0E8` | primary text |
| `text-dim` | `#7D8F7D` | secondary text, log timestamps |

Conventions: green = action/agent working; amber = money (app-wide invariant); red = error/refund. The `.dark` class variant collapses — one theme; delete the light parchment theme and the `ThemeApplicator` class toggle. Keep a `theme-color` meta, now set statically to `#0A0D0A` in `layout.tsx` (currently `ThemeApplicator` sets it at runtime for MiniPay only).

### Typography — 2 tiers (replaces the 3-tier codex system)

- **JetBrains Mono** — all UI chrome, labels, data, logs. Already in the stack.
- **Inter** (variable, ~30KB) — *only* for AI-generated thread content. Chrome is machine (mono); the output is writing for humans (sans). This contrast makes the product output read as the deliverable.
- **Removed:** IM Fell, EB Garamond.

### Texture & labels (approved defaults)

- Subtle CRT scanline/noise on the background (replaces parchment grain). Near-zero perf cost; trivial to remove.
- Labels UPPERCASE with letter-spacing (e.g. `AGENT SPEND · TODAY`).

### Component rules

- Radius 6–8px. No heavy glow/blur — MiniPay webview performance.
- The **log line** is the central visual unit: `[time] [status glyph] [service] [message] [$amount amber] [tx hash dim]`.
- Primary button: solid green, dark text, mono bold. Secondary: green text, soft border, transparent.
- Inputs: prompt-style with `>` prefix and blinking block cursor.

## Hero Screen — `AgentTrace` (Mission Control layout)

Replaces `GeneratingStatus`. The screen users/judges watch for 15–40s while the pipeline runs. Three layers:

1. **Pipeline stepper** — one cell per service (SERPER / GECKO / GROQ / FACT), each showing status glyph + amount paid. Cells light green on settle, amber while running, dim while waiting. Header shows thread id + running total (`SPENT $0.015 / $0.05`).
2. **Log window** — compact scrolling trace of pipeline events (queries, hook-engine scoring, draft streaming).
3. **Tweet cards** — appear as drafts stream in, rendered in Inter, **locked (🔒 "unlocks on settle")** until the x402 settle confirms. This is the backend's "settle gates delivery" invariant told as UI. Unlock is a visual state change only — the SSE event order already enforces the invariant; the UI must never render tweet text before the corresponding `step_output` event arrives.

Also runs in a **replay mode** (canned event script, no spend) reused as the landing hero demo.

## Screen-by-screen (restyle only, structure unchanged)

- **Landing:** mono logo + looping `AgentTrace` replay demo. Delete parchment hero.
- **Compose:** `ModePicker` → 2-button segment; prompt-style inputs; big green pay button with amber price.
- **ThreadPreview/Editor:** tweets on `surface` in Inter; keep banned-phrase highlight, recolor warning to amber.
- **History/Stats:** log-table rows (mono, one thread per line, amounts amber); stats as big-number cards.
- **Share/PostShare:** same flow, retheme.
- **ErrorSurface:** red + explicit refund status line (e.g. `✗ factcheck timeout — auto refund queued`), matching backend refundable states.

## Component migration map

| Current | Replacement |
|---|---|
| `CodexFrame` | `TerminalPanel` — bordered panel, `── TITLE ──` header |
| `InkDivider`, `FolioMark` | `RuleDivider` — 1px rule, optional mono label |
| `Marginalia` | `TraceNote` — dim mono annotation (same UX role, same props) |
| `GeneratingStatus` | `AgentTrace` (new, Mission Control) |
| `IllumIcons` | lucide-react directly, 16–20px |
| `InkText`, `InkBlot`, `MirrorScript`, `FolioSpread`, `RightLeafPlaceholder`, `ColophonIndex` | **Delete** — decorative only |

Replacements keep the same props/call sites where a replacement exists, so logic files don't change.

## Motion

Keep framer-motion, reduce to 2 patterns: log-line slide-in (light stagger) and blinking cursor. Remove elaborate screen transitions (webview performance).

## Migration order (each step = one commit; app ships consistently at every step)

1. Tokens: `globals.css` + `tailwind.config.ts` + fonts — whole app reskins day 1.
2. `AgentTrace` hero.
3. Compose + preview/editor.
4. Landing (reuses `AgentTrace` replay).
5. History / stats / share.
6. Delete dead codex components + purge unused font loading.

## Verification

- `pnpm test:lib` after every step (existing tests don't assert visuals).
- `pnpm build` + manual pass at 360px viewport.
- Full click-through of every screen before final commit.
- Out of bounds: `/api/generate`, `lib/pipeline/`, contracts, refund logic.

## Risks

- **Mission Control is ~1 extra day vs a raw log stream** — accepted; stepper answers "where am I / how long" at a glance.
- **Single theme removes the light web landing** — accepted; consistency beats dual maintenance under deadline.
- If the deadline compresses, stopping after any migration step still leaves a coherent app.
