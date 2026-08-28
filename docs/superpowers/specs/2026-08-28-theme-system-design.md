# Theme system — Terminal / Paper, CoinOp, 2026-08-28

Add a second theme and a user-facing toggle to an app that is, by an explicit
earlier decision, single-theme.

> `app/globals.css:6-8` — *"Agent Terminal — single dark theme … Tokens live on
> `:root` — there is no light theme."*

That decision is being revisited deliberately, not by accident. This spec
records what was decided, what it costs, and what must NOT change.

## Decisions taken

| Question | Answer |
|---|---|
| Why | A toggle as a product feature — control and polish, not an accessibility complaint |
| Light identity | **Paper** — a coin-op machine's printed receipt. Colour *semantics* survive, only lightness inverts |
| Default for a first-time visitor | **Terminal (dark), always.** Paper is opt-in and remembered |
| System `prefers-color-scheme` | **Not tracked.** Explicitly rejected — see below |

The default matters more than it looks. Most phones sit in light mode, so
following the OS would mean the majority of strangers never see the Agent
Terminal at all: the brand would become a function of someone else's setting.
Dark stays the first impression; Paper is a choice the user makes and the app
remembers.

## Prior art: this was tried once and removed

Do not rediscover this the hard way.

- `9b630cf` / `1c0214a` — *"Da Vinci codex parchment for web, slate dark for
  MiniPay"*. Two themes, selected by **whether the runtime was MiniPay**.
- `32aedf2` — *"Agent Terminal design tokens — single dark theme"*. Deleted
  `components/ThemeApplicator.tsx` and collapsed to one palette.

The old applicator's own docstring names its defect:

> *"Detection runs on mount so SSR is unaffected — there is a brief flash for
> MiniPay users (acceptable for an in-wallet webview)."*

It ran in `useEffect`, i.e. **after first paint**. Every user saw the wrong
theme and then a swap. This spec treats that flash as a defect, not a
trade-off, which is why the resolution moves into a blocking `<head>` script.

The parchment palette still exists in `32aedf2^:app/globals.css` and is
**not** being reused: it is a retired brand identity (sepia codex), it clashes
with the current CoinOp phosphor logo, and it has no `--money` token, which the
current app requires.

## What makes this cheap

Verified by survey, not assumed:

- `tailwind.config.ts:5` already sets `darkMode: ['class']`.
- Every colour in `tailwind.config.ts` maps to a CSS variable.
- **Zero hardcoded colours in `components/`.** The only literal hex values in
  the repo are the token definitions themselves (`app/globals.css`),
  `app/layout.tsx:66`, `app/opengraph-image.tsx`, and `app/providers.tsx:13-14`.
- Zero `dark:` variants anywhere (`grep -rn 'dark:' components app` → 0). The
  token layer is the whole theming mechanism; no component needs editing.

So the theme layer is ~18 CSS variables, and the work is concentrated in four
files plus one new toggle.

## Architecture

### Token layer

`:root` keeps the Terminal palette **byte-for-byte as it is today**. Paper is
purely additive:

```css
:root            { /* Terminal — unchanged */ }
html.theme-paper { /* Paper — same token names, overridden */ }
```

Consequence: the default rendering path cannot regress, because nothing on it
changes. `darkMode: ['class']` stays in the Tailwind config; it is currently
unused and this design does not start using it (`.theme-paper` is our own
class, and no `dark:` variants are introduced).

### Paper palette

Every value below was computed against WCAG, not eyeballed.

The Terminal column quotes `app/globals.css:10-30` verbatim — as HSL triples,
because that is the form the file stores. Paper is given as hex here for
legibility and converted to the same HSL form on implementation.

| Token | Paper | Contrast in Paper | Terminal (unchanged, from source) |
|---|---|---|---|
| `--background` | `#F2F0E6` | — | `120 13% 5%` |
| `--card` | `#FBFAF4` | — | `120 13% 8%` |
| `--foreground` | `#171A16` | 15.37 on bg / 16.79 on card | `120 21% 93%` |
| `--primary` | `#0F7A33` | 4.77 / 5.21 | `134 92% 66%` |
| `--money` | `#8A5A00` | 5.19 / 5.67 | `40 100% 64%` |
| `--destructive` | `#B3261E` | 5.72 on bg | `0 100% 68%` |
| `--muted-foreground` | `#676B64` | 4.76 / 5.20 | `120 8% 53%` |
| `--border` | `#D9D5C4` | non-text | `111 24% 16%` |
| `--secondary`, `--muted` | `#EFECE0` | ground — see below | `120 13% 11%` |
| `--accent` | `#E6EDE3` | ground — see below | `111 24% 16%` |
| `--input` | `#C7C2AE` | non-text | `111 24% 20%` |
| `--ring` | `#0F7A33` | = primary | `134 92% 66%` |
| `--primary-foreground` | `#FBFAF4` | 5.21 on primary | `140 60% 6%` |
| `--destructive-foreground` | `#FBFAF4` | 6.25 on destructive | `0 0% 98%` |
| `--card-foreground`, `--secondary-foreground`, `--accent-foreground` | `#171A16` | ≥13.7 on their grounds | `120 21% 93%` |

The two tinted grounds were tuned, not guessed. At a first draft of `#E7E4D6`
the `--secondary` ground failed on two pairs — `muted-foreground` at 4.26 and
`primary` at 4.27, both under 4.5 — so it was lightened to `#EFECE0`, where the
worst pair is 4.59. `--accent` moved from `#E2EADF` to `#E6EDE3` for the same
reason (4.42 → 4.55). Every text-on-ground pair in Paper now clears AA, which
is the property the contrast test below enforces from then on.

The semantic rule from `globals.css:6-8` — **green = action/agent, amber =
money, red = error** — is preserved exactly. Only lightness moves. Keeping
`#59F87D` on paper was never an option: it measures ~1.4:1.

### Resolution, without a flash

1. An inline, **blocking** `<script>` in `<head>` reads `localStorage`, and on
   `'paper'` adds `theme-paper` to `document.documentElement` before the first
   paint. Anything absent or unparseable resolves to Terminal.
2. `lib/theme.ts` holds the pure logic — `resolveTheme`, `nextTheme`, the
   storage key, and the `theme-color` value per theme — so it is unit-testable.
   **This placement is deliberate: `components/` is outside the vitest scope
   (`test:lib` = `vitest run lib app`) and the repo has no component-render
   harness, so logic left in a `.tsx` ships untested.**
3. A small client hook reads/writes the class and mirrors the choice to
   `localStorage`.

The inline script is the entire anti-FOUC mechanism. It is the one part that
cannot be moved into React without reintroducing `32aedf2`'s flash.

### Four things that do not follow from tokens

1. **`app/layout.tsx:66`** — `themeColor: '#0A0D0A'` is static. Left alone, a
   phone renders a black status bar above a paper page. The toggle updates the
   `<meta name="theme-color">` content, and the inline script sets the correct
   value on load.
2. **`app/providers.tsx:12-18`** — RainbowKit is configured with `lightTheme`
   and parchment accents `#8B5E2F` / `#F5EBD3`, a leftover of the deleted
   codex theme. **This is a live defect today**, independent of this work: on
   the current dark build the "Connect a Wallet" modal renders white with
   system fonts over the phosphor terminal. Fix as part of this change —
   Terminal gets `darkTheme` with a phosphor accent, Paper gets `lightTheme`
   with the ink-green accent.
3. **`app/globals.css:136-144`** — `.scanlines` draws CRT lines in a hardcoded
   near-black `hsl(120 40% 2% / 0.35)`. On paper those read as smudges. The
   line colour becomes a token so each theme states its own.
4. `::selection` and the scrollbar rules already reference tokens and follow
   for free.

### Deliberately excluded

- **`app/opengraph-image.tsx`, `app/icon.png`, `apple-icon.png` stay dark.**
  They are brand artwork, not themed surfaces. A link preview whose colour
  depends on the sharer's setting is a bug, not a feature.
- **No system-preference tracking**, per the decision above.
- **No third theme, no per-chain theming, no transition animation on the swap.**
  A cross-fade between two full palettes is exactly the kind of decorative
  motion `project_motion_pass` rules out.

### Toggle placement

A 36×36 nib in the header, left of the wallet chip — the repo's established nib
size (`CopyNib.tsx:29` and a dozen siblings), with `aria-pressed` and a label.
Placement is validated at 360×740 during implementation before it is fixed; if
the header crowds at that width, it moves into the wallet sheet and the
landing header, and this spec is amended rather than the width compromised.

## Testing

Three layers, in increasing cost.

1. **`lib/theme.ts` unit tests** — resolution from empty/garbage/valid storage,
   round-tripping, and the `theme-color` value per theme.
2. **Contrast test over `app/globals.css`** — parse the HSL triples out of both
   theme blocks and assert WCAG AA on every text-on-ground pair, for **both**
   themes. This is the load-bearing test: it turns "the light theme is
   readable" into a verified property, and it guards the existing dark palette
   against drift at the same time. It reads the CSS as the single source, so
   there is no second copy of the palette to fall out of sync.
3. **Playwright at 360×740 and 1440×900** —
   - no flash: assert `documentElement.className` is already correct on the
     first paint, with `localStorage` pre-seeded to `paper` before navigation;
   - toggle round-trip and persistence across a reload;
   - `<meta name="theme-color">` content matches the active theme;
   - `aria-pressed` tracks state;
   - the RainbowKit modal is dark under Terminal;
   - no horizontal overflow in either theme at either width;
   - screenshots of both themes for a human look.

## Risks

- **Paper is a second surface to maintain.** Every future colour decision now
  has two answers. The contrast test absorbs some of this, but not the
  aesthetic half. This is the real ongoing cost of the feature and it is
  accepted knowingly.
- **`text-money` on tinted grounds.** Several surfaces layer alpha tints
  (`bg-money/5`, `bg-primary/10`). Contrast on a *tinted* ground is not covered
  by the token-pair test; these need a visual pass in Paper.
- **Nothing here is device-tested.** As with every change in this session,
  MiniPay behaviour is unverified on hardware.

## Out of scope

The `docs/superpowers/specs/` directory was deliberately emptied in `04ff3cc`
("drop the stale walkthrough and let the agent rules stand alone"). This file
recreates it. If the project would rather not resurrect that folder, this
document moves to `docs/superpowers/plans/` or is deleted after implementation;
it is a working artefact, not a rule. Durable rules belong in `.claude/docs/`.
