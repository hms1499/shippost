import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_CHAIN_ID } from '@/lib/chainPolicy';

const getSupabaseServer = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));

const { GET } = await import('./route');

// Records every `.eq()` the route applies so a test can assert which chain it
// actually queried; the query resolves to an empty result set.
function mockQuery() {
  const eqCalls: [string, unknown][] = [];
  const cols: string[] = [];
  const client = {
    from() {
      const builder: any = {
        select: (c: string) => {
          cols.push(c);
          return builder;
        },
        order: () => builder,
        limit: () => builder,
        eq: (col: string, value: unknown) => {
          eqCalls.push([col, value]);
          return builder;
        },
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(resolve),
      };
      return builder;
    },
  };
  getSupabaseServer.mockReturnValue(client);
  return { eqCalls, cols };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/public/threads', () => {
  // A caller that omits chainId must get the chain this deployment actually
  // runs on. A hardcoded Celo id answered every such call with Celo's threads
  // long after Base became the default.
  it('falls back to the deployment default chain, not a hardcoded one', async () => {
    const { eqCalls } = mockQuery();

    const res = await GET(new Request('http://localhost/api/public/threads'));

    expect(res.status).toBe(200);
    expect(eqCalls).toContainEqual(['chain_id', DEFAULT_CHAIN_ID]);
  });

  it('honours an explicit chainId over the default', async () => {
    const { eqCalls } = mockQuery();

    await GET(new Request('http://localhost/api/public/threads?chainId=42220'));

    expect(eqCalls).toContainEqual(['chain_id', 42220]);
  });

  // The wallet filter is what keeps /history scoped to the connected wallet.
  it('lower-cases the wallet filter', async () => {
    const { eqCalls } = mockQuery();

    await GET(new Request('http://localhost/api/public/threads?wallet=0xAbC'));

    expect(eqCalls).toContainEqual(['wallet_address', '0xabc']);
  });

  // One unscoped call used to return fifty strangers' topics and finished
  // threads. What a run *is* stays public; what someone wrote does not.
  it('withholds written content from an unscoped listing', async () => {
    const { cols } = mockQuery();

    await GET(new Request('http://localhost/api/public/threads?chainId=42220'));

    expect(cols[0]).not.toContain('tweets');
    expect(cols[0]).not.toContain('topic');
    expect(cols[0]).toContain('onchain_thread_id');
    expect(cols[0]).toContain('status');
  });

  it('includes content once the caller names the wallet it belongs to', async () => {
    const { cols } = mockQuery();

    await GET(new Request('http://localhost/api/public/threads?wallet=0xabc'));

    expect(cols[0]).toContain('tweets');
    expect(cols[0]).toContain('topic');
  });
});
