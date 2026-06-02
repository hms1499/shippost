import { describe, it, expect, vi, beforeEach } from 'vitest';

const create = vi.fn();
vi.mock('groq-sdk', () => ({
  default: class { chat = { completions: { create } }; },
}));
// withX402 passes the handler through unchanged so we exercise handler logic.
vi.mock('@x402/next', () => ({
  withX402: (handler: unknown) => handler,
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
