import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_CHAIN_ID } from '@/lib/chainPolicy';

const getSupabaseServer = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));

const { GET } = await import('./route');

interface ThreadRow {
  amount_paid_raw?: string | null;
  token_symbol?: string;
}

// The route issues three selects against `threads`: a head count, a
// wallet_address list, and the cost/amount rows. Serve the same rows to all
// three; only the third is under test here.
function mockThreadRows(rows: ThreadRow[]) {
  const eqCalls: [string, unknown][] = [];
  const client = {
    from() {
      const builder: any = {
        select: (_cols: string, opts?: { head?: boolean }) => {
          builder._head = opts?.head === true;
          return builder;
        },
        eq: (col: string, value: unknown) => {
          eqCalls.push([col, value]);
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(
            builder._head
              ? { count: rows.length, data: null }
              : { data: rows.map((r) => ({ wallet_address: '0xa', ...r })) },
          ).then(resolve),
      };
      return builder;
    },
  };
  getSupabaseServer.mockReturnValue(client);
  return eqCalls;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/public/analytics', () => {
  // Two prices now coexist in history. Multiplying a thread count by a constant
  // is wrong for the old threads and the new ones alike.
  it('sums the actual amount each thread paid, across two prices', async () => {
    mockThreadRows([
      { amount_paid_raw: '50000', token_symbol: 'USDC' }, // $0.05
      { amount_paid_raw: '100000', token_symbol: 'USDC' }, // $0.10
      { amount_paid_raw: '100000000000000000', token_symbol: 'cUSD' }, // $0.10, 18 dec
    ]);

    const res = await GET(new Request('http://localhost/api/public/analytics?chainId=42220'));
    const body = await res.json();

    expect(body.volumeUsd).toBe('0.25');
  });

  it('scales each token by its own decimals, never a shared one', async () => {
    mockThreadRows([
      { amount_paid_raw: '100000', token_symbol: 'USDC' }, // 6 dec → $0.10
      { amount_paid_raw: '100000', token_symbol: 'cUSD' }, // 18 dec → $0.0000000000001
    ]);

    const res = await GET(new Request('http://localhost/api/public/analytics?chainId=42220'));
    const body = await res.json();

    // Treating cUSD as 6 decimals would have doubled this to 0.20.
    expect(body.volumeUsd).toBe('0.10');
  });

  // A row with no verified amount contributes nothing rather than a guess.
  it('skips rows with a missing amount instead of assuming a price', async () => {
    mockThreadRows([
      { amount_paid_raw: '100000', token_symbol: 'USDC' },
      { amount_paid_raw: null, token_symbol: 'USDC' },
    ]);

    const res = await GET(new Request('http://localhost/api/public/analytics?chainId=42220'));
    const body = await res.json();

    expect(body.volumeUsd).toBe('0.10');
  });

  it('skips a token that does not exist on the requested chain', async () => {
    // cUSD rows cannot occur on Base, but a bad row must not crash the endpoint.
    mockThreadRows([
      { amount_paid_raw: '100000', token_symbol: 'USDC' },
      { amount_paid_raw: '100000000000000000', token_symbol: 'cUSD' },
    ]);

    const res = await GET(new Request('http://localhost/api/public/analytics?chainId=8453'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.volumeUsd).toBe('0.10');
  });

  // A caller that omits chainId must get the chain this deployment actually
  // runs on. A hardcoded Celo id answered every such call with Celo's numbers
  // long after Base became the default.
  it('falls back to the deployment default chain, not a hardcoded one', async () => {
    const eqCalls = mockThreadRows([]);

    const res = await GET(new Request('http://localhost/api/public/analytics'));

    expect(res.status).toBe(200);
    expect(eqCalls).toContainEqual(['chain_id', DEFAULT_CHAIN_ID]);
  });
});
