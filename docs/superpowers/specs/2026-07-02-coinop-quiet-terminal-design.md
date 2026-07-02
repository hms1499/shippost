# CoinOp — Quiet Terminal (rebrand + UI de-noise)

**Date:** 2026-07-02 · **Status:** approved by user (this session)
**Deadline context:** must land before Proof of Ship judging (~2026-07-09), alongside nothing else.

## Problem

After the Agent Terminal redesign shipped and the real paid flow passed, user feedback:

1. The UI is "not clean" — specifically (user-confirmed, multi-select): too many
   decorative details, text too dense / not enough breathing room, too much
   mono + uppercase. **Explicitly NOT the color palette** — dark phosphor stays.
2. The name "ShipPost" is weak. User wants a name that evokes the real
   differentiator: *an on-chain agent that pays for itself* (x402 micro-payments).

Decision: rename to **CoinOp** ("coin-operated AI agent") + a surgical de-noise
pass ("Quiet Terminal", approach A). Both approved.

## Non-goals / out of scope

- **No contract changes.** `ShipPostPayment.sol` is deployed on Celo mainnet +
  Sepolia; the contract name, ABI, addresses, `getContracts().ShipPostPayment`
  key, and all test files keep the ShipPost name. Brand ≠ contract.
- No palette changes, no structural screen redesign (screen inventory and flows
  stay exactly as-is), no new features.
- Historical docs (`docs/superpowers/plans/*`, `docs/x402-*`, archive specs)
  are not rewritten.
- Vercel project name / deployment URL: outside code scope; user handles in
  dashboard if desired.
- Local repo directory name stays `shippost`.

## §1 Rebrand: CoinOp

Brand voice: a coin-operated machine. Coin in → machine audibly works → thread out.

| Surface | Current | New |
|---|---|---|
| `app/HomeClient.tsx:667` wordmark | `ShipPost` | `CoinOp` |
| `app/layout.tsx:23` title | `ShipPost — your agent writes, pays, ships` | `CoinOp — coin-operated AI agent` |
| `app/layout.tsx` meta description | (current) | `Drop $0.05 in. An on-chain agent pays AI services per call (x402) and hands you a ready-to-post X thread.` |
| Landing kicker `SHIPPOST // AGENT` | present | **deleted** (ornament rule §3) |
| Landing H1 | `Your agent writes, pays, ships.` | `One coin in. One thread out.` |
| Landing sub-copy | `Pay $0.05 once — an on-chain agent…` | keep meaning, re-voice: `Drop $0.05 — the agent pays AI services per call (x402) and delivers a ready-to-post X thread.` |
| `app/providers.tsx:26` RainbowKit `appName` | `ShipPost` | `CoinOp` |
| `app/HomeClient.tsx:714` wrong-network copy | `ShipPost runs on…` | `CoinOp runs on…` |
| `app/HomeClient.tsx:725` reopen copy | `…and reopen ShipPost.` | `…and reopen CoinOp.` |
| `app/api/x402/groq/route.ts:81` x402 offer description | `ShipPost AI thread generation (Groq)` | `CoinOp AI thread generation (Groq)` |
| `package.json` name | `shippost` | `coinop` |
| `README.md` | ShipPost branding throughout | Retitle `# CoinOp`, first line adds `(formerly ShipPost)`; rebrand prose. **Keep every `ShipPostPayment` contract reference and address verbatim.** |
| `CLAUDE.md` Project Overview | `**ShipPost** — a pay-per-use…` | `**CoinOp** (formerly ShipPost) — a coin-operated…` — one-line edit; contract references stay. |

Sweep rule: after edits, `grep -ri "shippost" app/ components/ lib/` must return
only `ShipPostPayment` contract references (config keys, explorer links).

## §2 Type discipline

Two-tier rule sharpened. **Mono (JetBrains Mono) is for data and actions only:**
numbers, $ amounts, addresses, tx hashes, ids, timestamps, log lines, panel
titles, form labels, buttons (buttons stay mono bold uppercase — identity, user
kept). **Inter, sentence case, is for every descriptive sentence:** mode
descriptions, helper text, error explanations, empty states, landing sub-copy.
(AI tweet content is already Inter — unchanged.)

`heading-sub` (uppercase + tracking) is reserved for **panel/section titles and
form field labels only**. Remove it from: inline chips, links ("back to
composer" style nav), sub-labels under buttons, one-off decorative labels.
Current spread (59 uses; heaviest: WalletMenu 9, stats 9, the three inputs 5
each) — expect roughly half to convert to normal-case Inter or plain mono.

## §3 Ornament reduction

- **TraceNote (`// …` asides): delete all usages** in `EducationalInput`,
  `DailyRecapInput`, `LandingHero`, `TokenAnalysisInput`, `HotTakeInput`,
  `HomeClient` (6 sites), then delete `components/terminal/TraceNote.tsx`.
  Content that still earns its place (e.g. "highest balance pre-selected")
  becomes plain Inter helper text; pure flavor (e.g. `$0.05 per thread, paid
  in stable //`) is deleted or folded into real copy.
- **Prompt prefixes:** `>` stays only inside real inputs. `$` prefixes outside
  inputs are removed (`$ index` → `Index` in ColophonIndex).
- **Scanline:** landing route only; removed from all other screens (currently
  global in `app/globals.css`).
- **Keep:** AgentTrace log glyphs (✓ / ⣷ / ✗) — functional log semantics; the
  `── TITLE ──` TerminalPanel header rule (it's the panel title device).

## §4 Space & structure

- Main column rhythm: section gap 6 → 8 (mobile) with a visible step between
  header / content / nav zones; TerminalPanel padding p-4 → p-5.
- **De-box the compose screens:** the three input screens + DailyRecap drop the
  outer TerminalPanel *border* (borderless section: title + whitespace
  separation). Borders remain only on true interactive elements — text inputs,
  buttons, selectable chips/cards. TerminalPanel grows a `plain` variant
  (no border/bg) rather than forking new components.
- Wallet balances panel → one compact row (three tokens inline), not a
  three-row bordered panel.
- Landing hero structure unchanged (already user-approved) apart from §1 copy,
  §2 type, and §3 TraceNote/scanline rules.

## §5 Verification

- `pnpm lint` + `pnpm test:lib` (fix any tests asserting old brand strings) +
  `pnpm build` all green.
- Brand sweep grep (§1) clean.
- 360×740 Playwright click-through with the mock EIP-1193/6963 wallet
  (established pattern): landing, connect, all four modes, history, stats — no
  horizontal overflow, screenshots eyeballed.
- Visual acceptance: user eyeballs dev build before the deadline push.
