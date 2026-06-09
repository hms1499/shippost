import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSupabaseServer = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));

const { GET } = await import('./route');

function makeSupabase(rows: Array<Record<string, unknown>>) {
  const calls: { gte?: string } = {};
  const client = {
    from() {
      return {
        select: () => ({
          gte: (_col: string, val: string) => {
            calls.gte = val;
            return Promise.resolve({ data: rows, error: null });
          },
        }),
      };
    },
  };
  return { client, calls };
}

function getReq(key?: string): Request {
  return new Request('http://localhost/api/admin/funnel?days=7', {
    headers: key ? { 'x-admin-key': key } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('REFUND_ADMIN_KEY', 'secret');
});
afterEach(() => vi.unstubAllEnvs());

describe('GET /api/admin/funnel', () => {
  it('401s without the admin key', async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it('401s with the wrong admin key', async () => {
    const res = await GET(getReq('nope'));
    expect(res.status).toBe(401);
  });

  it('503s when the admin key is not configured', async () => {
    vi.stubEnv('REFUND_ADMIN_KEY', '');
    const res = await GET(getReq('secret'));
    expect(res.status).toBe(503);
  });

  it('returns the computed funnel for the window', async () => {
    const { client } = makeSupabase([
      { session_id: 'a', stage: 'connect', mode: null },
      { session_id: 'a', stage: 'mode_select', mode: 1 },
    ]);
    getSupabaseServer.mockReturnValue(client);

    const res = await GET(getReq('secret'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.perStage.connect).toBe(1);
    expect(json.perStage.mode_select).toBe(1);
  });
});
