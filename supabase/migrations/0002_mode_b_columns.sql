-- Mode B (Hot Take) — angle + raw search/market context for replay/debugging.
alter table public.threads
  add column if not exists angle text,
  add column if not exists search_summary text,
  add column if not exists market_snippet text;
