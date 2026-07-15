# Funnel mode-4 fix + measurement — Implementation Plan

**Goal:** Stop the DB silently dropping mode-4 funnel events, and ship a local funnel-report script.

**Architecture:** One additive migration widening `funnel_events_mode_check` to include mode 4 (mirrors `0007`), plus a local ops script reading `funnel_events` (mirrors `scripts/x402-audit.ts`).

## Global Constraints

- Migrations additive/idempotent (`drop constraint if exists` + re-add).
- Mode CHECK must be exactly `(0,1,2,3,4)` — the modes that exist, no more.
- `scripts/` = local-only ops utility: not deployed, no unit test, not imported by app code. Mirror `scripts/x402-audit.ts` conventions (`import 'dotenv/config'`, `getSupabaseServer` from `../lib/supabase`).
- Mode labels (verbatim): 0 Educational, 1 Hot Take, 2 Token Analysis, 3 Daily Recap, 4 Comparison.
- Before "done": `pnpm test:lib`, `npx tsc --noEmit` (CI runs this over test files too — see [[project_ci_tsc_gap]]), and `pnpm build` all green.

---

### Task 1: Migration `0009_funnel_mode4.sql`

**Files:** Create `supabase/migrations/0009_funnel_mode4.sql`

- [ ] Write the migration (mirror `0007`'s mode-check block):

```sql
-- Comparison mode (mode 4, live 2026-07-13) emits funnel events the DB was
-- silently rejecting: the mode CHECK stopped at (0,1,2,3) (migration 0007,
-- itself the mode-3 fix). Widen to include 4 so mode-4 funnel events land.
-- threads.mode has no CHECK, so only funnel_events is affected.
alter table public.funnel_events
  drop constraint if exists funnel_events_mode_check;
alter table public.funnel_events
  add constraint funnel_events_mode_check check (mode in (0,1,2,3,4));
```

- [ ] Commit: `feat(db): funnel_events accepts mode 4 (comparison) — was silently rejected`

---

### Task 2: `scripts/funnel-report.ts` + alias

**Files:** Create `scripts/funnel-report.ts`; Modify `package.json` (add `"funnel:report": "tsx scripts/funnel-report.ts",` near `"audit:x402"`).

- [ ] Write the script: read `funnel_events` (columns `mode, stage, created_at`) for the last N days (default 30, `--days=N`), aggregate per-mode counts across the ordered stages `mode_select → submit → preview → pay → share`, print a labeled table per mode with Comparison (4) highlighted, plus a total. `connect` (mode null) counted separately as a top line. Mirror `x402-audit.ts` structure (arg parse, `getSupabaseServer`, `main().catch`).
- [ ] Add the `funnel:report` package.json alias.
- [ ] Verify: `pnpm test:lib` (unchanged green), `npx tsc --noEmit` (clean — script is a .ts file CI will typecheck), `pnpm build` (clean).
- [ ] Commit: `feat(ops): funnel-report — per-mode funnel counts incl. comparison (mode 4)`

## Self-Review
- Spec coverage: migration → Task 1; report script → Task 2. Covered.
- No placeholders; mode CHECK and labels verbatim.
- tsc --noEmit explicitly in the verification gate (CI-gap lesson applied).
