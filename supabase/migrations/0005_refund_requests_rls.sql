-- Revoke public read on refund_requests.
--
-- 0004 shipped `select using (true)`, which let anyone with the anon key
-- enumerate every wallet_address + their refund kind/status/history. No app
-- code relies on it: all access goes through getSupabaseServer() with the
-- service role, which bypasses RLS. Dropping the policy leaves RLS enabled
-- with no permissive policy = deny by default for anon, service role
-- unaffected.
drop policy if exists refund_requests_select_public on public.refund_requests;
