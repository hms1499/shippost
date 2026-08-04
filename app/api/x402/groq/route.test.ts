import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('groq-sdk', () => ({
  default: class { chat = { completions: { create } }; },
}));
// Records what the route declares to the x402 layer, so the 402 challenge's
// price/asset is assertable and not just whatever the SDK infers.
const x402Config = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
// withX402 passes the handler through unchanged so we exercise handler logic.
vi.mock('@x402/next', () => ({
  withX402: (handler: unknown, config: Record<string, unknown>) => {
    x402Config.last = config;
    return handler;
  },
  x402ResourceServer: class { register() { return this; } },
}));
vi.mock('@x402/evm/exact/server', () => ({ ExactEvmScheme: class {} }));
vi.mock('@x402/core/server', () => ({ HTTPFacilitatorClient: class {} }));
// boundThread throws on empty/junk; keep parsing real for fidelity.

const { POST: _POST } = await import('./route');
// In tests, withX402 is mocked as identity, so POST is the raw handler which
// accepts NextRequest. At runtime NextRequest extends Request, so casting here
// is safe for our test-only plain Request objects.
const POST = _POST as unknown as (req: Request) => Promise<Response>;

function postReq(body: unknown) {
  return new Request('http://localhost/api/x402/groq', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const okBody = { messages: [{ role: 'user', content: 'topic' }], temperature: 0.7, maxTokens: 1200 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('GROQ_API_KEY', 'test-key');
  vi.stubEnv('X402_PAY_TO', '0x' + '2'.repeat(40));
  vi.stubEnv('X402_CHAIN_ID', '84532');
});

describe('POST /api/x402/groq (handler)', () => {
  it('returns 200 with tweets when Groq returns a valid thread', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hello\n\n2/ world' } }] });
    const res = await POST(postReq(okBody));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.tweets)).toBe(true);
    expect(data.tweets.length).toBeGreaterThan(0);
  });

  it('returns 502 (no settle) when Groq throws', async () => {
    create.mockRejectedValue(new Error('groq down'));
    const res = await POST(postReq(okBody));
    expect(res.status).toBe(502);
  });

  it('returns 422 (no settle) when the output is empty/junk', async () => {
    create.mockResolvedValue({ choices: [{ message: { content: '   ' } }] });
    const res = await POST(postReq(okBody));
    expect(res.status).toBe(422);
  });

  it('returns 400 when messages are missing', async () => {
    const res = await POST(postReq({ temperature: 0.7 }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when messages is an empty array', async () => {
    const res = await POST(postReq({ messages: [] }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for a non-JSON body', async () => {
    const res = await POST(
      new Request('http://localhost/api/x402/groq', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 500 when GROQ_API_KEY is absent', async () => {
    vi.stubEnv('GROQ_API_KEY', '');
    create.mockResolvedValue({ choices: [{ message: { content: '1/ hi\n\n2/ there' } }] });
    const res = await POST(postReq(okBody));
    expect(res.status).toBe(500);
  });
});

// The route reads X402_CHAIN_ID once at module scope, so each chain needs a
// fresh import rather than a stubbed env on the already-loaded module.
async function loadRouteOn(chainId: number) {
  vi.resetModules();
  vi.stubEnv('X402_CHAIN_ID', String(chainId));
  vi.stubEnv('X402_PAY_TO', '0x' + '2'.repeat(40));
  await import('./route');
  return x402Config.last!.accepts as { price: unknown; network: string };
}

describe('402 challenge price', () => {
  // A money string ("$0.001") makes @x402/evm resolve the token through its own
  // DEFAULT_STABLECOINS table. That table has no Celo entry, so building the
  // challenge threw and every Celo run silently fell back to legacy.
  it('names the asset explicitly on Celo instead of leaving it to the SDK', async () => {
    const accepts = await loadRouteOn(42220);
    expect(accepts.network).toBe('eip155:42220');
    expect(accepts.price).toEqual({
      asset: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
      amount: '1000',
      extra: { name: 'USDC', version: '2' },
    });
  });

  it('names the asset explicitly on Base too — one code path, no SDK table', async () => {
    const accepts = await loadRouteOn(8453);
    expect(accepts.price).toEqual({
      asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      amount: '1000',
      extra: { name: 'USD Coin', version: '2' },
    });
  });
});
