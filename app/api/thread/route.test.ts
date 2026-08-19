import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const eqWallet = vi.fn(() => ({ maybeSingle }));
const eqThread = vi.fn(() => ({ eq: eqWallet }));
const eqChain = vi.fn(() => ({ eq: eqThread }));
const select = vi.fn((_columns: string) => ({ eq: eqChain }));
const from = vi.fn(() => ({ select }));

vi.mock('@/lib/supabase', () => ({ getSupabaseServer: () => ({ from }) }));

const { GET } = await import('./route');

const OWNER = '0xabcdef0123456789abcdef0123456789abcdef01';

function req(qs: string): Request {
  return new Request(`http://localhost/api/thread${qs}`);
}

/** The happy-path query string; tests that are not about the owner reuse it. */
const OK = `?chainId=42220&threadId=4182&wallet=${OWNER}`;

const ROW = {
  status: 'completed',
  tweets: ['1/ hook', '2/ body'],
  topic: 'zk rollups',
  amount_paid_raw: '100000000000000000',
  total_cost_usd: '0.003',
  token_symbol: 'cUSD',
  pay_tx_hash: '0x7f3a',
};

beforeEach(() => {
  vi.clearAllMocks();
  maybeSingle.mockResolvedValue({ data: ROW, error: null });
});

describe('GET /api/thread', () => {
  it('rejects a chain outside the allowlist', async () => {
    const res = await GET(req(`?chainId=1&threadId=4182&wallet=${OWNER}`));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a missing chainId', async () => {
    const res = await GET(req(`?threadId=4182&wallet=${OWNER}`));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric threadId', async () => {
    const res = await GET(req(`?chainId=42220&threadId=4182;DROP&wallet=${OWNER}`));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a negative threadId', async () => {
    const res = await GET(req(`?chainId=42220&threadId=-1&wallet=${OWNER}`));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  // Thread ids come off one sequential on-chain counter, so an id alone must
  // never be enough to read what someone wrote.
  it('rejects a missing wallet before touching the database', async () => {
    const res = await GET(req('?chainId=42220&threadId=4182'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid wallet' });
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects a malformed wallet', async () => {
    const res = await GET(req('?chainId=42220&threadId=4182&wallet=0xnope'));
    expect(res.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns 404 when no row matches', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const res = await GET(req(OK));
    expect(res.status).toBe(404);
  });

  it('returns the camelCased row for a completed thread', async () => {
    const res = await GET(req(OK));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'completed',
      tweets: ['1/ hook', '2/ body'],
      topic: 'zk rollups',
      amountPaidRaw: '100000000000000000',
      totalCostUsd: '0.003',
      tokenSymbol: 'cUSD',
      payTxHash: '0x7f3a',
    });
  });

  // The wallet is filtered in the query, not compared afterwards: a row owned by
  // someone else never leaves the database, and a wrong owner is answered with
  // the same 404 as a missing thread rather than an existence oracle.
  it('scopes the query to chain, thread id and owning wallet', async () => {
    await GET(req(OK));
    expect(eqChain).toHaveBeenCalledWith('chain_id', 42220);
    expect(eqThread).toHaveBeenCalledWith('onchain_thread_id', '4182');
    expect(eqWallet).toHaveBeenCalledWith('wallet_address', OWNER);
  });

  it('matches a checksummed address against the lower-cased column', async () => {
    await GET(req('?chainId=42220&threadId=4182&wallet=0xABCDEF0123456789ABCDEF0123456789ABCDEF01'));
    expect(eqWallet).toHaveBeenCalledWith('wallet_address', OWNER);
  });

  it('never selects a column beyond the resume payload', async () => {
    await GET(req(OK));
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
      ].sort(),
    );
  });

  // It used to answer any guessed id with the address that paid for it, which
  // is what turned anonymous content into attributed content.
  it('never returns the wallet that owns the thread', async () => {
    const res = await GET(req(OK));
    const body = await res.json();
    expect(body).not.toHaveProperty('walletAddress');
    expect(JSON.stringify(body)).not.toContain(OWNER);
  });

  it('returns 500 when Supabase errors', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: new Error('boom') });
    const res = await GET(req(OK));
    expect(res.status).toBe(500);
  });
});
