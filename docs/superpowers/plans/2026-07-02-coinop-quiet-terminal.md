# CoinOp — Quiet Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebrand ShipPost → CoinOp at the brand layer and de-noise the terminal UI (less ornament, less mono/uppercase, more whitespace) per `docs/superpowers/specs/2026-07-02-coinop-quiet-terminal-design.md`.

**Architecture:** Pure presentation-layer work: string/copy edits, Tailwind class changes, one component variant (`TerminalPanel plain`), one component deletion (`TraceNote`). No API, pipeline, contract, or state changes anywhere.

**Tech Stack:** Next.js 14 App Router, Tailwind 3.4, Vitest 4, existing Playwright-MCP mock-wallet click-through pattern.

## Global Constraints

- **Never rename contract identifiers.** `ShipPostPayment` (Solidity, `getContracts().ShipPostPayment`, addresses, test/contracts, explorer links) stays verbatim everywhere.
- Brand sweep acceptance: `grep -ri "shippost" app/ components/ lib/ --include="*.ts" --include="*.tsx"` returns ONLY `ShipPostPayment` contract references and the `shippost.app` URL constant (domain is out of scope; `NEXT_PUBLIC_APP_URL` overrides it in prod).
- Palette untouched. Buttons keep mono bold uppercase. AgentTrace log glyphs (✓/⣷/✗) and the `── TITLE ──` TerminalPanel header device stay.
- Type rule: mono = data/actions/titles/labels; Inter (`font-sans`) sentence case = every descriptive sentence.
- `heading-sub` allowed ONLY on panel/section titles and form field labels.
- After every task: `pnpm lint && pnpm test:lib` green; commit per task (trunk-based, direct on main).
- Never run `pnpm build` while the dev server is running (it clobbers `.next`).

---

### Task 1: Brand strings — shareText (TDD), app chrome, package.json

**Files:**
- Modify: `lib/shareText.test.ts`, `lib/shareText.ts:20-22`
- Modify: `app/layout.tsx:23-24`, `app/providers.tsx:26`, `app/HomeClient.tsx:667,714,725`, `app/api/x402/groq/route.ts:81`, `package.json:2,5`

**Interfaces:**
- Consumes: nothing.
- Produces: `buildShareText()` signature unchanged; only the attribution strings change to `✍️ made with CoinOp — ${url}` / `via CoinOp ${url}`.

- [ ] **Step 1: Update the share-text tests to expect CoinOp (failing first)**

In `lib/shareText.test.ts` replace every expectation string: `made with ShipPost` → `made with CoinOp`, `via ShipPost` → `via CoinOp`. Line 18's `shortSuffixLen` template literal too. Do NOT change the `https://shippost.app` URL constant.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/shareText.test.ts`
Expected: FAIL (received strings still say ShipPost).

- [ ] **Step 3: Update `lib/shareText.ts`**

```ts
  const full = `${firstTweet}\n\n✍️ made with CoinOp — ${url}`;
  if (full.length <= TWEET_MAX) return full;
  const short = `${firstTweet}\n\nvia CoinOp ${url}`;
```
Also update the file-top comment: "optionally appending a CoinOp attribution".

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/shareText.test.ts` → PASS.

- [ ] **Step 5: App chrome strings**

- `app/layout.tsx:23-24`:
```ts
  title: 'CoinOp — coin-operated AI agent',
  description: 'Drop $0.05 in. An on-chain agent pays AI services per call (x402) and hands you a ready-to-post X thread.',
```
- `app/providers.tsx:26`: `appInfo={{ appName: 'CoinOp' }}`
- `app/HomeClient.tsx:667`: wordmark text `ShipPost` → `CoinOp`
- `app/HomeClient.tsx:714`: `…ShipPost runs on…` → `…CoinOp runs on…`
- `app/HomeClient.tsx:725`: `…and reopen ShipPost.` → `…and reopen CoinOp.`
- `app/api/x402/groq/route.ts:81`: `description: 'CoinOp AI thread generation (Groq)'`
- `package.json`: `"name": "coinop"`, description → `"Coin-operated AI thread writer — MiniPay MiniApp"`

- [ ] **Step 6: Sweep gate + full checks**

Run: `grep -rn "ShipPost" app/ components/ lib/ --include="*.ts*" | grep -v ShipPostPayment | grep -v shippost.app`
Expected: no output.
Run: `pnpm lint && pnpm test:lib` → green.

- [ ] **Step 7: Commit** — `git commit -m "feat(brand): rename ShipPost → CoinOp across app chrome and share attribution"`

---

### Task 2: README + CLAUDE.md rebrand

**Files:** Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1: README** — Retitle `# CoinOp`; directly under the title add: `> Formerly **ShipPost** — the on-chain contract keeps the historical name \`ShipPostPayment\`.` Replace product-brand uses of "ShipPost" with "CoinOp" in prose (intro, "User opens … inside MiniPay", "frontend" tree label, "spans two chains"). Leave every `ShipPostPayment` contract name, address, env-var table row, and diagram box that names the contract byte-identical.
- [ ] **Step 2: CLAUDE.md** — Project Overview first line → `**CoinOp** (formerly ShipPost) — a coin-operated, pay-per-use AI thread writer running as a MiniApp inside Opera's MiniPay wallet.` (rest of the sentence/paragraph unchanged). Contract references stay.
- [ ] **Step 3: Verify** — `grep -n "ShipPost" README.md CLAUDE.md | grep -v ShipPostPayment | grep -v "Formerly" | grep -v "formerly"` → no output.
- [ ] **Step 4: Commit** — `git commit -m "docs(brand): CoinOp rebrand in README and CLAUDE.md, contract names untouched"`

---

### Task 3: Landing copy + delete TraceNote everywhere

**Files:**
- Modify: `components/LandingHero.tsx`, `app/HomeClient.tsx:14,678-682`, `components/EducationalInput.tsx:8,140`, `components/TokenAnalysisInput.tsx:9,164`, `components/HotTakeInput.tsx:9,173`, `components/DailyRecapInput.tsx:8,99`
- Delete: `components/terminal/TraceNote.tsx`

**Interfaces:** Produces: `TraceNote` no longer exists; nothing may import it after this task.

- [ ] **Step 1: Rewrite `LandingHero.tsx` hero block** (kicker deleted, new H1, sub-copy in Inter, TraceNote → plain helper):

```tsx
      <div className="text-center flex flex-col items-center gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          One coin in. <span className="text-primary">One thread out.</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs font-sans">
          Drop <span className="font-mono text-money">$0.05</span> — the agent pays AI
          services per call (x402) and delivers a ready-to-post X thread.
        </p>
      </div>
```
and replace `<TraceNote side="right">or sign in from the corner ↗</TraceNote>` with:
```tsx
        <p className="text-xs font-sans text-muted-foreground text-center">
          or sign in from the corner ↗
        </p>
```
Remove the `TraceNote` import.

- [ ] **Step 2: `app/HomeClient.tsx`** — delete the whole `{mounted && !isMiniPay && (<TraceNote …>$0.05 per thread…</TraceNote>)}` block (lines ~678-682; the flat fee already shows in ModePicker's footer) and the line-14 import.

- [ ] **Step 3: Input helpers** — in each file remove the `TraceNote` import, then:
  - `EducationalInput.tsx:140` `<TraceNote side="right">highest balance pre-selected</TraceNote>` → `<p className="text-xs font-sans text-muted-foreground">Highest balance pre-selected.</p>`
  - `DailyRecapInput.tsx:99` `…fresh data every run…` → `<p className="text-xs font-sans text-muted-foreground">Fresh data every run.</p>`
  - `TokenAnalysisInput.tsx:164` and `HotTakeInput.tsx:173` (`same cost either angle`): delete the line outright — pure flavor; the You-pay row already states cost.

- [ ] **Step 4: Delete the component** — `git rm components/terminal/TraceNote.tsx`, then `grep -rn "TraceNote" app/ components/ lib/` → no output.

- [ ] **Step 5: Verify + commit** — `pnpm lint && pnpm test:lib && pnpm build` → green. `git commit -m "feat(ui): CoinOp landing copy; remove TraceNote ornament everywhere"`

---

### Task 4: Scanline becomes landing-only

**Files:** Modify: `app/globals.css:47-55`, `components/LandingHero.tsx` (root section)

- [ ] **Step 1:** In `globals.css`, cut the `background-image: repeating-linear-gradient(…)` declaration (and its comment) out of `body`, and add below the `@layer base` block:

```css
/* CRT scanlines — landing hero only (Quiet Terminal: texture off content screens). */
.scanlines {
  background-image: repeating-linear-gradient(
    0deg,
    transparent 0px,
    transparent 2px,
    hsl(120 40% 2% / 0.35) 2px,
    hsl(120 40% 2% / 0.35) 3px
  );
}
```

- [ ] **Step 2:** `LandingHero.tsx` root: `className="relative w-full max-w-md flex flex-col items-center gap-6 scanlines rounded-lg"`
- [ ] **Step 3: Verify + commit** — dev server eyeball: texture on landing, none on /stats. `git commit -m "feat(ui): scanline texture scoped to landing hero"`

---

### Task 5: TerminalPanel `plain` variant, de-boxed compose, spacing, one-row balances

**Files:**
- Modify: `components/terminal/TerminalPanel.tsx`, `components/EducationalInput.tsx:69`, `components/HotTakeInput.tsx`, `components/TokenAnalysisInput.tsx`, `components/DailyRecapInput.tsx` (their `<TerminalPanel>` usage), `app/HomeClient.tsx:656` (main gap), `components/WalletStatus.tsx`

**Interfaces:**
- Produces: `TerminalPanel({ title?, children, className?, variant? })` where `variant?: 'framed' | 'plain'`, default `'framed'`. Framed = border+bg+p-5; plain = no border/bg, `px-0 py-1`.

- [ ] **Step 1: Variant + padding bump in `TerminalPanel.tsx`:**

```tsx
export function TerminalPanel({
  title,
  children,
  className,
  variant = 'framed',
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  variant?: 'framed' | 'plain';
}) {
  const frame =
    variant === 'framed'
      ? 'rounded-lg border border-border bg-card p-5'
      : 'px-0 py-1';
  return (
    <section className={`${frame} ${className ?? ''}`}>
```
(title row unchanged.)

- [ ] **Step 2:** In the four compose screens, the outer `<TerminalPanel className="w-full">` → `<TerminalPanel variant="plain" className="w-full">`. Inputs/buttons/chips inside keep their own borders.
- [ ] **Step 3:** `app/HomeClient.tsx:656` main: `gap-6` → `gap-8`.
- [ ] **Step 4: WalletStatus one-row.** Replace the `<ul>` leader-dot list (lines 41-95) with a single inline row; keep the loading/empty branches as the row's content:

```tsx
      <div className="flex items-center gap-4 text-sm">
        {isLoading ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" aria-hidden />
            Loading balances…
          </span>
        ) : balances.length === 0 ? (
          <span className="text-xs font-sans text-muted-foreground">
            No stable balances on this chain.
          </span>
        ) : (
          balances.map((b) => {
            const amount = Number(formatUnits(b.balance, b.decimals));
            const isTop = b.symbol === topSymbol;
            return (
              <span key={b.symbol} className="flex items-baseline gap-1.5">
                <span
                  className={
                    'text-xs ' + (isTop ? 'text-foreground font-medium' : 'text-muted-foreground')
                  }
                >
                  {b.symbol}
                </span>
                <span className={'font-mono tabular-nums text-money ' + (isTop ? 'font-bold' : '')}>
                  {amount.toFixed(2)}
                </span>
              </span>
            );
          })
        )}
      </div>
```
The header row (label + shortened address) and the `Connected via` footer stay; Card padding `p-4` → `p-5`, `gap-3` → `gap-2`. Drop the now-unused dot spans/dotted leader.

- [ ] **Step 5: Verify + commit** — `pnpm lint && pnpm test:lib && pnpm build` green; dev eyeball compose screens (no double frames). `git commit -m "feat(ui): plain compose panels, one-row balances, wider rhythm"`

---

### Task 6: heading-sub scope — components

**Files:** Modify: `components/ThreadPreview.tsx:176,216,225`, `components/PreviewLocked.tsx:59`, `components/WalletMenu.tsx:159,213,237,261`

Conversion rule (exact): on the listed sites replace `heading-sub text-[10px]` (or `text-[9px]`) with `font-mono text-[11px] text-muted-foreground`, keeping all other classes (layout, hover) intact. Source text is already sentence case; removing the class removes the uppercase/tracking.

Keep (titles/labels — do not touch): `ThreadPreview:75`, `ComposeSummary:41,79`, `PreviewLocked:21`, `PostShareScreen:44`, `WalletStatus:33`, `WalletMenu:204`, all `TerminalPanel` titles, form labels in the input screens, and the WalletMenu action pills (`:102,116,125,288` — they are buttons/status chips, buttons keep their case).

- [ ] **Step 1:** Apply the rule to the six sites.
- [ ] **Step 2: Descriptive sentences → Inter (spec §2).** Body text defaults to mono, so add `font-sans` to the className of every descriptive-sentence element in components (sentences only — never data rows, log lines, or bracket-tag lines like `[grounded · …]`, which stay mono):
  - `ModePicker`: the per-mode description `<p>`s (e.g. "React to news or a tweet with data…") and the footer line "flat $0.05/thread — mode only changes the agent's recipe" (keep its `$0.05` span mono/amber).
  - The four input screens: intro lines ("Describe the concept and the reader.", "Paste a URL or describe the event.", "Name a token…", Daily Recap recipe sentences) and the insufficient-balance warning `<p>`s.
  - `PreviewLocked:22-25` sample description; `ErrorSurface` body paragraphs (all three kinds); `HistoryList` empty/error `<p>`s; `ColophonIndex` entry `description` `<p>`; `ThreadPreview`/`PostShareScreen`/`ComposeSummary` descriptive sentences (not their ledger/data rows).
- [ ] **Step 3: Verify + commit** — `pnpm lint && pnpm test:lib`; dev eyeball preview + wallet menu + composer. `git commit -m "feat(ui): uppercase micro-labels reserved for titles/labels; prose set in Inter"`

---

### Task 7: heading-sub scope + ornaments — pages and ColophonIndex

**Files:** Modify: `app/stats/page.tsx:75,128,137,153,181,236`, `app/history/page.tsx:25`, `components/ColophonIndex.tsx:47`

- [ ] **Step 1:** Same conversion rule as Task 6 on: stats `75` (back link), `128`,`137` (audit/inspect links), `153` ("last 5" sub-label), `181` (see-more link), `236` (tx link); history `25` (back link). Keep stats `82,98,151` and history `32` (page kickers/section titles).
- [ ] **Step 2:** `ColophonIndex.tsx:47`: `$ index` → `Index` (keep `heading-sub` — it is the nav's section title).
- [ ] **Step 3: Page prose → Inter (spec §2).** Add `font-sans` to descriptive sentences on both pages: stats intro ("Pulled live from the chain. Refreshed every 30 seconds."), history intro ("Every thread you've run, in order."), and any error/empty paragraphs. Metric values, ledger rows, and entry rows stay mono.
- [ ] **Step 4: Verify + commit** — `pnpm lint && pnpm test:lib`; dev eyeball /stats + /history. `git commit -m "feat(ui): quiet link styling and Inter prose on stats/history; index header drops \$ prompt"`

---

### Task 8: Final verification sweep

**Files:** none new (fix-ups only if checks fail).

- [ ] **Step 1: Brand sweep** — run the Global Constraints grep → only `ShipPostPayment` + `shippost.app` hits.
- [ ] **Step 2: Ornament sweep** — `grep -rn "TraceNote\|\\$ index\|SHIPPOST" app/ components/` → no output; `grep -c "heading-sub" -r components/ app/` total should be roughly half of 59 (~30).
- [ ] **Step 3:** `pnpm lint && pnpm test:lib && pnpm build` → all green (stop dev server first).
- [ ] **Step 4: 360×740 click-through** — start `pnpm dev`; use the established Playwright-MCP mock-wallet pattern (addInitScript injecting an EIP-1193 provider + EIP-6963 announce for rdns `io.metamask`, address `0x1111…1111`, chainId `0xa4ec`): landing (scanline present, "One coin in."), connect, ModePicker, all four mode screens (type into each input), /history, /stats. Assert `document.documentElement.scrollWidth === clientWidth` on every screen; screenshot each and eyeball.
- [ ] **Step 5:** Update `.superpowers/sdd/progress.md` ledger; final commit of any fix-ups — `git commit -m "chore(ui): CoinOp quiet-terminal verification fixes"` (only if needed).
- [ ] **Step 6:** Ask the user for the visual acceptance pass (spec §5) before the deadline push.
