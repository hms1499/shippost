-- Anonymous funnel events for drop-off analysis (C1). One row per stage entry,
-- keyed by a client-generated session UUID (no PII). wallet_address is
-- pseudonymous and nullable (attached from `connect` onward) so the funnel can
-- later be joined to real conversions in `threads`. Service-role only.
create table if not exists public.funnel_events (
  id             bigint generated always as identity primary key,
  session_id     text        not null,
  stage          text        not null check (stage in
                   ('connect','mode_select','submit','preview','pay','share')),
  mode           smallint    check (mode in (0,1,2)),
  chain_id       integer,
  wallet_address text,
  created_at     timestamptz not null default now()
);

create index if not exists funnel_events_stage_idx     on public.funnel_events (stage);
create index if not exists funnel_events_session_idx    on public.funnel_events (session_id);
create index if not exists funnel_events_created_at_idx on public.funnel_events (created_at);

-- No anon RLS policy: reads/writes go through the service-role client only,
-- matching `threads`. RLS stays disabled (service role bypasses it regardless).
