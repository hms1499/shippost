-- 1) New top-of-funnel stage: 'visit' — fired once per session on landing,
--    before connect, so share-link clicks that never connect MiniPay are still
--    counted. Widen the stage check (mirrors 0007's pattern).
-- 2) New column: source — first-touch acquisition tag (e.g. 'x' from an X share
--    link). Nullable; most events have none. Kept as free text (validated to a
--    small whitelist in the app) so a new source needs no migration.
alter table public.funnel_events
  drop constraint if exists funnel_events_stage_check;
alter table public.funnel_events
  add constraint funnel_events_stage_check check (stage in
    ('visit','connect','mode_select','submit','preview','pay','share','receipt_copied'));

alter table public.funnel_events
  add column if not exists source text;

create index if not exists funnel_events_source_idx on public.funnel_events (source);
