-- News Breakdown (mode 5) emits funnel events the current CHECK rejects: the
-- mode constraint stops at (0,1,2,3,4) (migration 0009, itself the mode-4
-- fix). Widen to include 5. threads.mode has no CHECK, so only funnel_events
-- is affected.
alter table public.funnel_events
  drop constraint if exists funnel_events_mode_check;
alter table public.funnel_events
  add constraint funnel_events_mode_check check (mode in (0,1,2,3,4,5));
