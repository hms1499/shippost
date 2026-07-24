import { describe, it, expect, vi, beforeEach } from 'vitest';

const checkRateLimit = vi.fn();
const getClientIp = vi.fn(() => 'test-ip');
const getSupabaseServer = vi.fn();

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit, getClientIp }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));

const { POST } = await import('./route');

function makeSupabase() {
  const inserts: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      return {
        insert(row: Record<string, unknown>) {
          inserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { client, inserts };
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/public/funnel', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const VALID = {
  session_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  stage: 'pay',
  mode: 1,
  chain_id: 42220,
  wallet_address: '0x' + 'a'.repeat(40),
};

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ success: true });
});

describe('POST /api/public/funnel', () => {
  it('inserts a sanitized row for a valid event and returns 202', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    const res = await POST(postReq(VALID));

    expect(res.status).toBe(202);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toEqual({
      session_id: VALID.session_id,
      stage: 'pay',
      mode: 1,
      chain_id: 42220,
      wallet_address: VALID.wallet_address,
      source: null,
    });
  });

  it('drops (202, no insert) when over the rate limit', async () => {
    checkRateLimit.mockResolvedValue({ success: false });
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    const res = await POST(postReq(VALID));

    expect(res.status).toBe(202);
    expect(inserts).toHaveLength(0);
  });

  it('drops (202, no insert) on an invalid stage', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    const res = await POST(postReq({ ...VALID, stage: 'checkout' }));

    expect(res.status).toBe(202);
    expect(inserts).toHaveLength(0);
  });

  it('drops (202, no insert) on a bad session id, mode, or wallet', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    await POST(postReq({ ...VALID, session_id: 'nope' }));
    await POST(postReq({ ...VALID, mode: 9 }));
    await POST(postReq({ ...VALID, wallet_address: '0x123' }));

    expect(inserts).toHaveLength(0);
  });

  it('drops absent optional fields to null in the row', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    await POST(postReq({ session_id: VALID.session_id, stage: 'connect' }));

    expect(inserts[0]).toEqual({
      session_id: VALID.session_id,
      stage: 'connect',
      mode: null,
      chain_id: null,
      wallet_address: null,
      source: null,
    });
  });

  it('accepts a visit event with a valid source', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    await POST(postReq({ session_id: VALID.session_id, stage: 'visit', source: 'x' }));

    expect(inserts[0]).toEqual({
      session_id: VALID.session_id,
      stage: 'visit',
      mode: null,
      chain_id: null,
      wallet_address: null,
      source: 'x',
    });
  });

  it('nulls an invalid source instead of dropping the event', async () => {
    const { client, inserts } = makeSupabase();
    getSupabaseServer.mockReturnValue(client);

    await POST(postReq({ ...VALID, source: 'evil' }));

    expect(inserts).toHaveLength(1);
    expect(inserts[0].source).toBeNull();
  });

  it('returns 202 (never throws) on malformed JSON', async () => {
    const res = await POST(postReq('{not json'));
    expect(res.status).toBe(202);
  });

  it('returns 202 (no insert) when Supabase is unavailable', async () => {
    getSupabaseServer.mockImplementation(() => { throw new Error('no env'); });
    const res = await POST(postReq(VALID));
    expect(res.status).toBe(202);
  });
});
