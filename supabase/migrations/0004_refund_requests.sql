-- Refund request queue: user-initiated requests admin processes off-chain via `pnpm refund`.
-- One row per (thread, wallet, kind) — `unique` prevents click-spam from creating duplicates.
create table if not exists public.refund_requests (
  id bigint generated always as identity primary key,
  chain_id int not null,
  onchain_thread_id text not null,
  wallet_address text not null,
  kind text not null check (kind in ('full', 'partial', 'slow-cancel')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'rejected')),
  refund_tx_hash text,
  rejection_reason text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists refund_requests_unique_idx
  on public.refund_requests (chain_id, onchain_thread_id, wallet_address, kind);

create index if not exists refund_requests_pending_idx
  on public.refund_requests (status, created_at)
  where status = 'pending';

alter table public.refund_requests enable row level security;

-- Public read so users (and the public analytics page) can see request status.
drop policy if exists refund_requests_select_public on public.refund_requests;
create policy refund_requests_select_public on public.refund_requests
  for select
  using (true);
