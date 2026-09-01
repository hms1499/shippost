import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the two boundaries the route touches: the rate limiter (always allow
// here) and Supabase. We assert the route's guards — wallet ownership, the
// already-refunded short-circuit, and the new "don't cancel-refund a delivered
// thread" guard — without a real DB.
const checkRateLimit = vi.fn();
const getClientIp = vi.fn(() => 'test-ip');
const getSupabaseServer = vi.fn();

vi.mock('@/lib/rateLimit', () => ({ checkRateLimit, getClientIp }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));

const { POST } = await import('./route');

const WALLET = '0x1111111111111111111111111111111111111111';

interface ThreadRow {
  wallet_address: string;
  status: string;
  refund_tx_hash: string | null;
}

function makeSupabase(thread: ThreadRow | null) {
  const upserts: Array<Record<string, unknown>> = [];
  const client = {
    from(table: string) {
      if (table === 'threads') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () => Promise.resolve({ data: thread, error: null }),
              }),
            }),
          }),
        };
      }
      // refund_requests
      return {
        upsert(payload: Record<string, unknown>) {
          upserts.push(payload);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: { id: 'req-1', status: 'pending', created_at: 'now' },
                  error: null,
                }),
            }),
          };
        },
      };
    },
  };
  return { client, upserts };
}

function postReq(body: unknown): Request {
  return new Request('http://localhost/api/refund-request', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  checkRateLimit.mockResolvedValue({ success: true, limit: 5, remaining: 5, reset: Date.now() });
});

describe('refund-request — slow-cancel guard', () => {
  it('rejects slow-cancel on a completed (delivered) thread with 409', async () => {
    const { client, upserts } = makeSupabase({
      wallet_address: WALLET,
      status: 'completed',
      refund_tx_hash: null,
    });
    getSupabaseServer.mockReturnValue(client);

    const res = await POST(
      postReq({ chainId: 42220, onchainThreadId: '7', walletAddress: WALLET, kind: 'slow-cancel' }),
    );

    expect(res.status).toBe(409);
    expect(upserts).toHaveLength(0); // never queued
  });

  it('allows slow-cancel on a failed thread', async () => {
    const { client, upserts } = makeSupabase({
      wallet_address: WALLET,
      status: 'failed',
      refund_tx_hash: null,
    });
    getSupabaseServer.mockReturnValue(client);

    const res = await POST(
      postReq({ chainId: 42220, onchainThreadId: '7', walletAddress: WALLET, kind: 'slow-cancel' }),
    );

    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
  });

  it('still allows partial refunds on a completed (degraded) thread', async () => {
    const { client, upserts } = makeSupabase({
      wallet_address: WALLET,
      status: 'completed',
      refund_tx_hash: null,
    });
    getSupabaseServer.mockReturnValue(client);

    const res = await POST(
      postReq({ chainId: 42220, onchainThreadId: '7', walletAddress: WALLET, kind: 'partial' }),
    );

    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
  });
});

describe('refund-request — the queued message', () => {
  it('makes no turnaround promise the payout path cannot keep', async () => {
    // Refunds are sent by a human running `pnpm refund:process`, and the
    // on-chain refund() reverts outright while the contract's reserve is empty
    // (Celo reserve is 0; Base holds ~2 refunds' worth). A "within 24h" SLA is
    // therefore a promise nothing in the system can honour.
    const { client } = makeSupabase({
      wallet_address: WALLET,
      status: 'failed',
      refund_tx_hash: null,
    });
    getSupabaseServer.mockReturnValue(client);

    const res = await POST(
      postReq({ chainId: 42220, onchainThreadId: '7', walletAddress: WALLET, kind: 'full' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).not.toMatch(/24\s*h|hour|within/i);
    expect(body.message).toMatch(/by hand|manually/i);
  });
});
