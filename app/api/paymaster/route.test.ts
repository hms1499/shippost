import { describe, it, expect, vi, beforeEach } from 'vitest';

const PAYMENT = '0x0dea32414e884253b51a43b19a6a8c6b8f3b1800';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ATTACKER = '0x000000000000000000000000000000000000dead';

// lib/contracts reads NEXT_PUBLIC_PAYMENT_CONTRACT_BASE at module load, so the
// address has to exist before the route is imported — a beforeEach would be
// too late and every request would 503.
process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_BASE = PAYMENT;
process.env.CDP_PAYMASTER_URL = 'https://paymaster.example/rpc';

const { POST } = await import('./route');

function rpc(method: string, to: string, data = '0x', chainHex = '0x2105') {
  return new Request('http://localhost/api/paymaster', {
    method: 'POST',
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: [{ callData: data, to }, '0x', chainHex],
    }),
  });
}

function approveCalldata(spender: string) {
  return `0x095ea7b3${spender.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}`;
}

beforeEach(() => {
  process.env.CDP_PAYMASTER_URL = 'https://paymaster.example/rpc';
  vi.restoreAllMocks();
});

describe('/api/paymaster', () => {
  it('rejects an unknown JSON-RPC method', async () => {
    const res = await POST(rpc('eth_sendTransaction', PAYMENT));
    expect(res.status).toBe(400);
  });

  // Without this the endpoint is a public wallet: anyone who finds it can have
  // their own transactions sponsored.
  it('refuses to sponsor a call to any contract but ours', async () => {
    const res = await POST(rpc('pm_getPaymasterData', ATTACKER));
    expect(res.status).toBe(403);
  });

  it('refuses an approve whose spender is not the payment contract', async () => {
    const res = await POST(rpc('pm_getPaymasterData', USDC, approveCalldata(ATTACKER)));
    expect(res.status).toBe(403);
  });

  it('refuses a non-approve call to a token contract', async () => {
    // transfer(attacker, 1) — selector 0xa9059cbb, not approve.
    const data = `0xa9059cbb${ATTACKER.slice(2).padStart(64, '0')}${'1'.padStart(64, '0')}`;
    const res = await POST(rpc('pm_getPaymasterData', USDC, data));
    expect(res.status).toBe(403);
  });

  it('allows an approve whose spender is the payment contract', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })));

    const res = await POST(rpc('pm_getPaymasterData', USDC, approveCalldata(PAYMENT)));

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://paymaster.example/rpc',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('allows a call to the payment contract itself', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })),
    );

    const res = await POST(rpc('pm_getPaymasterStubData', PAYMENT));
    expect(res.status).toBe(200);
  });

  it('refuses a chain other than Base mainnet', async () => {
    const res = await POST(rpc('pm_getPaymasterData', PAYMENT, '0x', '0x1'));
    expect(res.status).toBe(403);
  });

  it('never leaks the upstream paymaster URL', async () => {
    const res = await POST(rpc('pm_getPaymasterData', ATTACKER));
    expect(await res.text()).not.toContain('paymaster.example');
  });

  it('returns 503 rather than forwarding when no upstream is configured', async () => {
    delete process.env.CDP_PAYMASTER_URL;
    const fetchMock = vi.spyOn(globalThis, 'fetch');

    const res = await POST(rpc('pm_getPaymasterData', PAYMENT));

    expect(res.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed body', async () => {
    const res = await POST(
      new Request('http://localhost/api/paymaster', { method: 'POST', body: '{ not json' }),
    );
    expect(res.status).toBe(400);
  });

  // Deny-by-default: a request with no params at all must not reach upstream.
  it('refuses a request with no userOp', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const res = await POST(
      new Request('http://localhost/api/paymaster', {
        method: 'POST',
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'pm_getPaymasterData' }),
      }),
    );
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
