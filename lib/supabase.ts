import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let serverClient: SupabaseClient | null = null;

export function getSupabaseServer(): SupabaseClient {
  if (serverClient) return serverClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE;
  if (!url || !key) throw new Error('Supabase env vars missing');
  serverClient = createClient(url, key, {
    auth: { persistSession: false },
    global: {
      // Next patches the global fetch and decides caching from the *route
      // segment* that happens to be running. This client is memoised across
      // requests, so it can capture one route's caching context and apply it
      // to every other route — whichever one calls Supabase first after a cold
      // start silently decides how fresh everyone else's data is.
      //
      // That is how /api/thread got pinned to a `pending` row: the first poll's
      // response was written to the on-disk fetch cache and every later poll
      // was served that same answer, so a thread that had finished never
      // arrived and the resume screen checked forever.
      //
      // A database read is never a cacheable fetch. Route-level `revalidate`
      // stays the only caching layer, which is what it was meant to be.
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, cache: 'no-store' }),
    },
  });
  return serverClient;
}
