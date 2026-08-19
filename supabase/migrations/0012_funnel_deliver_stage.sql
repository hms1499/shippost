-- New stage: 'deliver' — fired when a generated thread reaches the user.
--
-- 'share' used to fire at that moment, which made it a delivery counter sitting
-- at ~100% of 'pay' by construction, and left the app with no signal at all for
-- "the user says they posted it". 'share' now fires only on the "I posted it"
-- button; 'deliver' takes the slot it vacated.
--
-- Rows written before this migration carry the old meaning — for any window
-- reaching back past 2026-08-19, 'share' is inflated and 'deliver' is absent.
-- Widening only (mirrors 0007 / 0011); no existing row is rewritten, because
-- a historical event should keep whatever it actually recorded.
alter table public.funnel_events
  drop constraint if exists funnel_events_stage_check;
alter table public.funnel_events
  add constraint funnel_events_stage_check check (stage in
    ('visit','connect','mode_select','submit','preview','pay','deliver','share','receipt_copied'));
