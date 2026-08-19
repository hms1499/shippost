-- Payments that were rejected before a thread row existed.
--
-- /api/generate/stream verifies on chain and answers 402 BEFORE inserting into
-- `threads`, so a rejected request leaves no trace. That is right for a forged
-- body and wrong for a real payment the server could not read (a lagging RPC, a
-- repricing landing mid-flight): the user is charged on chain and no refund
-- path, sweep or history page ever sees it. Base threads 1000007 and 1000008
-- were lost exactly that way.
--
-- Only the AMBIGUOUS rejections land here (see lib/agent/orphanPayments.ts):
--   receipt-unavailable — could not read the receipt; may or may not be real
--   mismatch            — our contract DID emit ThreadRequested, so money moved
-- A reverted tx, or one that never paid our contract, is not recorded.
--
-- This is a TRIAGE QUEUE for a human. Nothing reads it to send money, and a row
-- is a lead to check on the explorer, not a proven debt — which is what makes it
-- safe to accept `receipt-unavailable`, where a fabricated hash is
-- indistinguishable from a real payment. Rows can therefore be created by
-- anyone POSTing invented hashes; the unique index collapses repeats.
create table if not exists public.orphan_payments (
  id                  bigint generated always as identity primary key,
  chain_id            int         not null,
  pay_tx_hash         text        not null,
  -- What the request claimed.
  wallet_address      text        not null,
  claimed_thread_id   text,
  token_address       text,
  mode                smallint,
  -- Why it was rejected.
  reason              text        not null check (reason in ('receipt-unavailable', 'mismatch')),
  detail              text,
  -- What the chain actually said, when it said anything (mismatch only).
  observed_thread_id  text,
  observed_payer      text,
  observed_amount_raw text,
  -- Operator triage.
  status              text        not null default 'open'
                        check (status in ('open', 'refunded', 'dismissed')),
  resolution_note     text,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz
);

-- One row per payment, however many times it is retried or replayed.
create unique index if not exists orphan_payments_tx_idx
  on public.orphan_payments (chain_id, pay_tx_hash);
create index if not exists orphan_payments_status_idx
  on public.orphan_payments (status);
create index if not exists orphan_payments_wallet_idx
  on public.orphan_payments (wallet_address);

-- No anon RLS policy: service-role only, matching `threads` and `refund_requests`.
