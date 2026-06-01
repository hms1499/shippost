# ESLint setup — design

**Date:** 2026-06-01
**Status:** Approved (design), pending implementation plan

## Problem

The repo has a `lint` script (`next lint`) but no ESLint config and no `eslint`
package installed. Running `pnpm lint` drops into an interactive setup prompt
("How would you like to configure ESLint?"), so it cannot run in CI — which is
why the CI workflow (`.github/workflows/ci.yml`) currently omits a lint step
with a note to add it once ESLint is wired up.

`next.config.js` sets `eslint.ignoreDuringBuilds: false`, meaning once a config
exists, `next build` will run ESLint as part of the build. Any **error**-level
violation will then fail `pnpm build` (and therefore CI). The build currently
passes only because, with no config, Next skips linting.

## Goals

- `pnpm lint` runs non-interactively and exits 0.
- `pnpm build` still passes with linting active (lint gates the build, as the
  existing `ignoreDuringBuilds: false` intends).
- Add a `pnpm lint` step to CI.

## Non-goals (YAGNI)

- Prettier or formatting tooling.
- Custom ESLint rules or plugins beyond `eslint-config-next`.
- Linting `scripts/`, `tools/`, `test/`, `contracts/` (kept out of scope to
  bound the blast radius; `next lint` default dirs cover the priority surface).
- Migrating to ESLint 9 flat config.

## Approach

**Toolchain**

- Dev dependencies: `eslint@^8.57` and `eslint-config-next@14.2.35` (matching
  the installed Next.js 14.2.35).
- **ESLint 8, not 9:** `eslint-config-next@14` does not cleanly support ESLint
  9's flat config. Use the legacy `.eslintrc.json` + ESLint 8 path, which is the
  supported configuration for Next 14.
- `.eslintrc.json`:
  ```json
  { "extends": "next/core-web-vitals" }
  ```
  The strict preset — includes React hooks rules, accessibility (jsx-a11y), and
  Core Web Vitals checks.
- Leave `next.config.js` `eslint.ignoreDuringBuilds: false` unchanged: lint
  gates the build.

**Lint scope**

Use `next lint`'s default directories: `app`, `components`, `lib`. These are the
priority surface. `scripts/`, `tools/`, `test/`, `contracts/` are not linted by
default and stay out of scope this round.

**Fix strategy (adaptive)**

1. Install + add config, then run `pnpm lint` to measure the real violation
   count.
2. Apply `next lint --fix` for mechanically auto-fixable violations.
3. Hand-fix the remainder so lint is fully green.
4. **Escape hatch:** if a single rule produces an overwhelming number of
   violations, or fixing requires risky changes to working logic (e.g.
   `react-hooks/exhaustive-deps` on sensitive hooks), stop and bring the user
   options (fix vs. a justified targeted `// eslint-disable` vs. downgrading
   that one rule) rather than mass-editing working code unilaterally.

**CI**

Add a `pnpm lint` step to `.github/workflows/ci.yml` after the typecheck step,
and remove the "lint intentionally omitted" comment.

## Verification

- `pnpm lint` → exit 0, no errors.
- `pnpm build` → succeeds (lint runs during build and passes).
- `pnpm test:lib` and `npx tsc --noEmit` → still green (no regressions).

## Files touched

- `package.json` / `pnpm-lock.yaml` (two new devDependencies)
- `.eslintrc.json` (new)
- `.github/workflows/ci.yml` (add lint step, drop the omission comment)
- Any files under `app/`, `components/`, `lib/` that have violations (count TBD
  at implementation time; see fix strategy)

## Risk

The number of existing violations is unknown until measured. The fix strategy's
escape hatch (step 4) handles the case where "fix clean" turns out to be large
or risky: the implementer pauses and escalates rather than forcing it.
