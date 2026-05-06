-- Refund audit trail: link an off-chain refund tx + reason to the original thread row.
alter table public.threads
  add column if not exists refund_tx_hash text,
  add column if not exists refund_reason text;
