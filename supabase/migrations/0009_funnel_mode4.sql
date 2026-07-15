-- Comparison mode (mode 4, live 2026-07-13) emits funnel events the DB was
-- silently rejecting: the mode CHECK stopped at (0,1,2,3) (migration 0007,
-- itself the mode-3 fix). Widen to include 4 so mode-4 funnel events land.
-- threads.mode has no CHECK, so only funnel_events is affected.
alter table public.funnel_events
  drop constraint if exists funnel_events_mode_check;
alter table public.funnel_events
  add constraint funnel_events_mode_check check (mode in (0,1,2,3,4));
