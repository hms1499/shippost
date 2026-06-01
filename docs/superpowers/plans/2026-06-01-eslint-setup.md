# ESLint Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire `eslint-config-next` (strict) so `pnpm lint` runs non-interactively and green, fix existing violations, and add a lint step to CI.

**Architecture:** Add ESLint 8 + `eslint-config-next@14.2.35` with a legacy `.eslintrc.json` extending `next/core-web-vitals`. Because `next.config.js` has `eslint.ignoreDuringBuilds: false`, lint runs during `next build`, so error-level violations must be fixed before the config lands — Task 1 therefore enables the config AND fixes to green in a single commit so `main` is never left with a red build.

**Tech Stack:** ESLint 8, eslint-config-next, Next.js 14.2.35, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-01-eslint-setup-design.md`

---

## Pre-existing working-tree state (read before Task 1)

`package.json` and `scripts/withdraw-agent.ts` have **uncommitted** WIP from unrelated prior work (a `tools:collect` script alias + collect-celo tool). Do NOT commit them. Task 1 stashes them around `pnpm add` so the config commit stays clean, then restores them. `scripts/` is not linted (out of scope), so the fixes in this plan never touch the WIP files.

## Lint scope note

`next lint` defaults to linting `app/`, `components/`, `lib/` (the dirs that exist here). `scripts/`, `tools/`, `test/`, `contracts/` are NOT linted — intentional, per the spec. Do not add `--dir` flags.

---

### Task 1: Enable ESLint and fix to green (single atomic commit)

**Files:**
- Create: `.eslintrc.json`
- Modify: `package.json`, `pnpm-lock.yaml` (via `pnpm add`)
- Modify: any files under `app/`, `components/`, `lib/` that have violations (set determined by measurement in Step 4)

- [ ] **Step 1: Stash the unrelated pre-existing WIP**

Run:
```bash
git stash push -m "wip-collect-tool (eslint plan)" -- package.json scripts/withdraw-agent.ts
git status --short
```
Expected: `package.json` and `scripts/withdraw-agent.ts` no longer show as modified.

- [ ] **Step 2: Install ESLint and the Next config**

Run:
```bash
pnpm add -D eslint@^8.57.0 eslint-config-next@14.2.35
```
Expected: both added under `devDependencies`; `pnpm-lock.yaml` updated; no errors.

- [ ] **Step 3: Create the ESLint config**

Create `.eslintrc.json` with exactly:
```json
{
  "extends": "next/core-web-vitals"
}
```

- [ ] **Step 4: Measure violations (non-interactive)**

Run:
```bash
pnpm lint
```
Expected: it runs WITHOUT the interactive setup prompt (config now exists) and prints either "No ESLint warnings or errors" or a list of violations grouped by file. Read the output carefully — note each rule and whether it is `Error` or `Warning`.

**Decision gate:** If the output shows more than ~20 error-level violations, OR any fix would require changing runtime behavior of working code (e.g. `react-hooks/exhaustive-deps` where adding a dep would change effect timing), STOP here: run `git stash pop` to restore WIP and report back to the controller with the full rule→count breakdown and your concern. Do NOT mass-edit working logic or commit. Otherwise continue.

- [ ] **Step 5: Apply automatic fixes**

Run:
```bash
pnpm lint --fix
```
(`next lint` forwards `--fix` to ESLint.) Expected: mechanically fixable violations (e.g. import ordering, some formatting) are resolved. Re-run `pnpm lint` to see what remains.

- [ ] **Step 6: Hand-fix the remaining violations**

Fix each remaining violation in `app/`, `components/`, or `lib/`. Common `next/core-web-vitals` violations and their correct fixes:

- **`react/no-unescaped-entities`** — replace a literal `'` in JSX text with `&apos;` (or `&#39;`), and `"` with `&quot;`. Example: `<p>don't</p>` → `<p>don&apos;t</p>`.
- **`@next/next/no-img-element`** — prefer `next/image`'s `<Image>`. If the surrounding code intentionally uses `<img>` (e.g. an OG preview of arbitrary remote URLs that should not go through the image optimizer), add a scoped disable on the line with a brief reason: `{/* eslint-disable-next-line @next/next/no-img-element -- remote OG preview, not optimized */}`.
- **`jsx-a11y/alt-text`** — add a meaningful `alt` (or `alt=""` for decorative images).
- **`react-hooks/rules-of-hooks`** (error) — must be fixed structurally (move the hook to the top level). If this appears and is non-trivial, treat it as the Step 4 decision gate and escalate.
- **`react-hooks/exhaustive-deps`** (warning) — do NOT blindly add deps (can change behavior). If a missing dep is genuinely safe to add, add it; otherwise add `// eslint-disable-next-line react-hooks/exhaustive-deps` with a one-line reason. When unsure, escalate per Step 4.

After fixing, re-run `pnpm lint` until it reports no errors (warnings acceptable only if you deliberately left a justified `exhaustive-deps` case; prefer zero).

- [ ] **Step 7: Verify lint, build, types, and tests are all green**

Run each and confirm:
```bash
pnpm lint          # exit 0, no errors
pnpm build         # ✓ Compiled successfully (lint runs during build and passes)
npx tsc --noEmit   # exit 0
pnpm test:lib      # all tests pass
```
If `pnpm build` fails on a lint error, return to Step 6.

- [ ] **Step 8: Commit config + deps + fixes as one green commit**

Stage the config, dependency files, and exactly the source files you changed (list them explicitly; do NOT use `git add -A`, which would sweep the restored WIP):
```bash
git add .eslintrc.json package.json pnpm-lock.yaml
# then add each source file you fixed, e.g.:
# git add components/SomeComponent.tsx app/page.tsx
git commit -m "chore(eslint): enable next/core-web-vitals and fix violations

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

- [ ] **Step 9: Restore the pre-existing WIP**

Run:
```bash
git stash pop
git status --short
```
Expected: `package.json` and `scripts/withdraw-agent.ts` reappear as modified (` M`); leave them unstaged (WIP). If `git stash pop` conflicts in `package.json` (the WIP touches `scripts`, your commit touched `devDependencies` — different regions, so a conflict is unlikely), keep BOTH the new devDependencies and the `tools:collect` line, leave unstaged.

---

### Task 2: Add lint to CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Replace the omission comment and add a lint step**

In `.github/workflows/ci.yml`, replace this block:
```yaml
      # Typecheck stands in for lint: `next lint` is not configured yet (no
      # ESLint config) and prompts interactively, which would hang CI. Add a
      # `pnpm lint` step here once ESLint is wired up.
      - name: Typecheck
        run: npx tsc --noEmit
```
with (lint runs after typecheck, per the spec):
```yaml
      - name: Typecheck
        run: npx tsc --noEmit

      - name: Lint
        run: pnpm lint
```

- [ ] **Step 2: Sanity-check the YAML and that lint passes locally**

Run:
```bash
pnpm lint
```
Expected: exit 0, no errors (same as Task 1 Step 7).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run pnpm lint in the pipeline

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Full verification gate

No code changes — confirm the whole pipeline is green with ESLint active.

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: exit 0, no errors.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Library tests**

Run: `pnpm test:lib`
Expected: all tests pass.

- [ ] **Step 4: Production build**

Run: `pnpm build`
Expected: `✓ Compiled successfully`, no lint failures, full route table.

- [ ] **Step 5: Confirm no stray changes**

Run: `git status --short`
Expected: only the pre-existing WIP (` M package.json`, ` M scripts/withdraw-agent.ts`) remains uncommitted. All ESLint work is committed.
