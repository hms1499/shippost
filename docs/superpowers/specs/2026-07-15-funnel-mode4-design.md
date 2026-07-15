# Funnel mode-4 fix + measurement (design)

Date: 2026-07-15
Status: approved

## Problem

`funnel_events.mode` has a CHECK constraint that stops at `(0,1,2,3)` (last set in
migration `0007`). The app emits `mode=4` funnel events for Comparison mode (live
on prod since 2026-07-13), so the DB **silently rejects** every mode-4 event
(funnel writes are fire-and-forget). A prod probe on 2026-07-15 confirmed: 186
recent events across modes 0/1/2/3/null, **zero mode=4**. This is the exact
mode-3 bug that `0007` fixed, recurring for mode 4.

Consequence: mode-4 usage cannot be measured — the data never lands. "0 rows"
today is ambiguous between "constraint rejects it" and "nobody used it". Fixing
the constraint is a prerequisite for any meaningful measurement.

Scope note: `threads.mode` has NO CHECK constraint, so only `funnel_events` is
affected. Only that one constraint needs widening.

## Goal

(1) Stop silently dropping mode-4 funnel events; (2) give a repeatable funnel
report that answers "does Comparison get used" going forward, and surfaces the
drop-off shape for all modes now.

## Approach — 2 small commits

### Commit 1 — migration `0009_funnel_mode4.sql`
Mirror `0007` exactly:
```sql
alter table public.funnel_events
  drop constraint if exists funnel_events_mode_check;
alter table public.funnel_events
  add constraint funnel_events_mode_check check (mode in (0,1,2,3,4));
```
Additive. Once applied to prod, the app (already emitting mode=4) records mode-4
events immediately — no app redeploy needed.

### Commit 2 — `scripts/funnel-report.ts` (+ `pnpm funnel:report`)
Local ops tool, same class as `scripts/x402-audit.ts` (not deployed, no unit
test, not imported by app code). Reads `funnel_events` for the last N days
(default 30, `--days=N`) and prints, per mode, the funnel counts
`mode_select → submit → preview → pay → share`, with mode labels
(0 Educational, 1 Hot Take, 2 Token Analysis, 3 Daily Recap, 4 Comparison).
Comparison (mode 4) is highlighted. Reads only `funnel_events` (one table, like
the audit).

## Honest limitation

The fix does NOT recover the mode-4 events already rejected — measurement is
prospective only. That is unavoidable.

## Alternatives considered (rejected)

- Cross-check `threads` completed-by-mode in the same script — YAGNI; the `pay`
  stage already approximates conversion. Keep it single-table.
- Widen to a broader mode range "for the future" — YAGNI; widen to exactly the
  modes that exist (0-4).

## Out of scope

Any change to funnel emission code (it already sends mode 4 correctly), the
stage set, or `threads`.
