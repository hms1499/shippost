import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Typed parameters on purpose: an untyped vi.fn() infers a zero-arg mock, so
// reading `mock.calls[0][2]` is an empty-tuple index — green under vitest, red
// under tsc, and neither `test:lib` nor `build` typechecks this file.
const createClient = vi.fn((_url: string, _key: string, _opts: unknown) => ({ mock: true }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));

const ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE = 'service-role-key';
});
afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe('getSupabaseServer', () => {
  it('throws when the env is missing rather than creating a useless client', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE;
    const { getSupabaseServer } = await import('./supabase');
    expect(() => getSupabaseServer()).toThrow(/env vars missing/i);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('memoises the client', async () => {
    const { getSupabaseServer } = await import('./supabase');
    expect(getSupabaseServer()).toBe(getSupabaseServer());
    expect(createClient).toHaveBeenCalledOnce();
  });

  // The memoised client outlives the request that created it, so under Next's
  // patched fetch it can inherit another route's caching context. That once
  // pinned /api/thread to a `pending` row forever: the first poll was written
  // to the on-disk fetch cache and every later poll was served that same
  // answer, so a finished thread never arrived.
  it('reads through a fetch that can never be served from a cache', async () => {
    const spy = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('[]'));
    vi.stubGlobal('fetch', spy);

    const { getSupabaseServer } = await import('./supabase');
    getSupabaseServer();

    const opts = createClient.mock.calls[0][2] as {
      global?: { fetch?: (i: unknown, init?: RequestInit) => Promise<Response> };
    };
    expect(opts.global?.fetch).toBeTypeOf('function');

    await opts.global!.fetch!('https://example.supabase.co/rest/v1/threads', { method: 'GET' });
    expect(spy).toHaveBeenCalledOnce();
    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.cache).toBe('no-store');
    // The caller's own options must survive alongside it.
    expect(init.method).toBe('GET');
  });
});
