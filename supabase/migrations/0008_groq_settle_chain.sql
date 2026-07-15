-- Record which chain the Groq step settled on, so a thread can be classified
-- as Model 2 (x402, USDC on Base) vs legacy (cUSD on Celo). The row's chain_id
-- is the PAYMENT chain (Celo); the Groq x402 settle lands on Base, so a bare
-- groq_tx_hash cannot be classified without this. Nullable: rows predating this
-- column stay null = "pre-audit, unknown".
alter table public.threads
  add column if not exists groq_settle_chain_id int;
