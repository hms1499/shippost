import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the three boundaries: the on-chain refund, the alert sink, and Supabase.
// We assert the money-critical alert wiring — send failure and sent-but-not-
// recorded — plus that a clean refund stays silent and the guards still hold.
const refundThread = vi.fn();
const alertOps = vi.fn();
const getSupabaseServer = vi.fn();

vi.mock('@/lib/agent/orchestrator', () => ({ refundThread }));
vi.mock('@/lib/alert', () => ({ alertOps }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));

const { POST } = await import('./route');

const ADMIN = 'admin-key';
const TO = '0x1111111111111111111111111111111111111111';
const VALID_BODY = {
  chainId: 42220,
  onchainThreadId: '7',
  to: TO,
  tokenSymbol: 'cUSD',
  amountHuman: '0.05',
  reason: 'run failed',
};

function makeSupabase(opts: {
  existing?: { refund_tx_hash: string | null } | null;
  precheckError?: { message: string } | null;
  stampError?: { message: string } | null;
} = {}) {
  const existing = opts.existing === undefined ? { refund_tx_hash: null } : opts.existing;
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: existing, error: opts.precheckError ?? null }),
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ error: opts.stampError ?? null }),
          }),
        }),
      };
    },
  };
}

function req(body: unknown, headers: Record<string, string> = { 'x-admin-key': ADMIN }): Request {
  return new Request('http://localhost/api/refund', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.REFUND_ADMIN_KEY = ADMIN;
  getSupabaseServer.mockReturnValue(makeSupabase());
  refundThread.mockResolvedValue('0xtxhash');
});

describe('POST /api/refund', () => {
  it('401s and does nothing without a valid admin key', async () => {
    const res = await POST(req(VALID_BODY, { 'x-admin-key': 'wrong' }));
    expect(res.status).toBe(401);
    expect(refundThread).not.toHaveBeenCalled();
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('409s when the thread was already refunded (no alert)', async () => {
    getSupabaseServer.mockReturnValue(makeSupabase({ existing: { refund_tx_hash: '0xold' } }));
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(409);
    expect(refundThread).not.toHaveBeenCalled();
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('alerts and 502s when the refund send fails', async () => {
    refundThread.mockRejectedValue(new Error('rpc timeout'));
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(502);
    expect(alertOps).toHaveBeenCalledOnce();
    expect(alertOps.mock.calls[0][0]).toMatch(/send fail/i);
  });

  it('alerts a double-send risk when the payout succeeds but the DB stamp fails', async () => {
    getSupabaseServer.mockReturnValue(makeSupabase({ stampError: { message: 'supabase down' } }));
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ txHash: '0xtxhash' });
    expect(alertOps).toHaveBeenCalledOnce();
    expect(alertOps.mock.calls[0][0]).toMatch(/not (stamped|recorded)|double-send/i);
  });

  it('stays silent on a clean refund and threads the onchainThreadId through', async () => {
    const res = await POST(req(VALID_BODY));
    expect(res.status).toBe(200);
    expect(alertOps).not.toHaveBeenCalled();
    expect(refundThread.mock.calls[0][0]).toMatchObject({ onchainThreadId: '7' });
  });
});
