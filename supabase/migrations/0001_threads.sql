-- threads: one row per paid generation
create table if not exists public.threads (
  id bigint generated always as identity primary key,
  chain_id int not null,
  onchain_thread_id text not null,
  wallet_address text not null,
  mode smallint not null, -- 0 = educational, 1 = hot-take
  token_symbol text not null,
  token_address text not null,
  amount_paid_raw text not null,    -- raw base units as string (bigint)
  pay_tx_hash text not null,
  topic text,
  audience text,
  length int,
  tweets jsonb,
  total_cost_usd text,
  groq_tx_hash text,
  serper_tx_hash text,
  coingecko_tx_hash text,
  fact_check_tx_hash text,
  status text not null default 'pending', -- 'pending' | 'completed' | 'failed'
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists threads_wallet_idx on public.threads (wallet_address);
create index if not exists threads_chain_idx on public.threads (chain_id);
create index if not exists threads_created_idx on public.threads (created_at desc);
create unique index if not exists threads_onchain_idx on public.threads (chain_id, onchain_thread_id);

-- Minimal rate-limit support: count threads per wallet per 24h window
-- queried from API with: select count(*) from threads where wallet_address = $1 and created_at > now() - interval '24 hours';

alter table public.threads enable row level security;

-- Anyone can select (public history page, Week 3 analytics); only service role inserts/updates.
drop policy if exists threads_select_public on public.threads;
create policy threads_select_public on public.threads
  for select
  using (true);
