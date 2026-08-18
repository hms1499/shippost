import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const eqChain = vi.fn(() => ({ eq: eqThread }));
const eqThread = vi.fn(() => ({ maybeSingle }));
const select = vi.fn((_columns: string) => ({ eq: eqChain }));
const from = vi.fn(() => ({ select }));

vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => ({ from }) }));

const { GET } = await import('./route');

function req(qs: string): Request {
  return new Request(`http://localhost/api/thread${qs}`);
}

const ROW = {
  status: 'completed',
  tweets: ['1/ hook', '2/ body'],
  topic: 'zk rollups',
  amount_paid_raw: '100000000000000000',
  total_cost_usd: '0.003',
  token_symbol: 'cUSD',
  pay_tx_hash: '0x7f3a',
  wallet_address: '0xabc',
};

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: ROW, error: null });
});

describe('GET /api/thread', () => {
  it('rejects a chain outside the allowlist', async () => {
    const res = await GET(req('?chainId=1&threadId=4182'));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a missing chainId', async () => {
    const res = await GET(req('?threadId=4182'));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric threadId', async () => {
    const res = await GET(req('?chainId=42220&threadId=4182;DROP'));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a negative threadId', async () => {
    const res = await GET(req('?chainId=42220&threadId=-1'));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns 404 when no row matches', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(req('?chainId=42220&threadId=4182'));
    expect(res.status).toBe(404);
  });

  it('returns the camelCased row for a completed thread', async () => {
    const res = await GET(req('?chainId=42220&threadId=4182'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'completed',
      tweets: ['1/ hook', '2/ body'],
      topic: 'zk rollups',
      amountPaidRaw: '100000000000000000',
      totalCostUsd: '0.003',
      tokenSymbol: 'cUSD',
      payTxHash: '0x7f3a',
      walletAddress: '0xabc',
    });
  });

  it('scopes the query to both chain and thread id', async () => {
    await GET(req('?chainId=42220&threadId=4182'));
    expect(eqChain).toHaveBeenCalledWith('chain_id', 42220);
    expect(eqThread).toHaveBeenCalledWith('onchain_thread_id', '4182');
  });

  it('never selects a column beyond the resume payload', async () => {
    await GET(req('?chainId=42220&threadId=4182'));
    const cols = (select.mock.calls[0][0] as string).split(',');
    expect(cols.sort()).toEqual(
      [
        'amount_paid_raw',
        'pay_tx_hash',
        'status',
        'token_symbol',
        'topic',
        'total_cost_usd',
        'tweets',
        'wallet_address',
      ].sort(),
    );
  });

  it('returns 500 when Supabase errors', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: new Error('boom') });
    const res = await GET(req('?chainId=42220&threadId=4182'));
    expect(res.status).toBe(500);
  });
});
