-- 1) New funnel stage: 'receipt_copied' — fired when the user copies the
--    post-run receipt to share it. Measures whether the receipt actually
--    drives word-of-mouth.
-- 2) Fix: the original mode check predates Daily Recap (mode 3), so every
--    funnel event carrying mode=3 has been rejected by the DB. Widen to 0-3.
alter table public.funnel_events
  drop constraint if exists funnel_events_stage_check;
alter table public.funnel_events
  add constraint funnel_events_stage_check check (stage in
    ('connect','mode_select','submit','preview','pay','share','receipt_copied'));

alter table public.funnel_events
  drop constraint if exists funnel_events_mode_check;
alter table public.funnel_events
  add constraint funnel_events_mode_check check (mode in (0,1,2,3));
