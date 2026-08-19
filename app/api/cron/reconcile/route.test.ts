import { describe, it, expect, vi, beforeEach } from 'vitest';

const reconcileStuckThreads = vi.fn();
const checkAgentWalletBalance = vi.fn();
const checkOrchestratorGas = vi.fn();
const checkReserveBalance = vi.fn();
const checkPreviewAlive = vi.fn();
const claimAlertOnce = vi.fn();
const alertOps = vi.fn();
const getSupabaseServer = vi.fn(() => ({}));
const shareAppUrl = vi.fn(() => 'https://app.test');

vi.mock('@/lib/agent/reconcile', () => ({ reconcileStuckThreads }));
vi.mock('@/lib/agent/walletHealth', () => ({
  checkAgentWalletBalance,
  checkOrchestratorGas,
  checkReserveBalance,
  minGasOverrideForChain: () => undefined,
}));
vi.mock('@/lib/agent/previewHealth', () => ({ checkPreviewAlive }));
vi.mock('@/lib/rateLimit', () => ({ claimAlertOnce }));
vi.mock('@/lib/alert', () => ({ alertOps }));
vi.mock('@/lib/shareText', () => ({ shareAppUrl }));
vi.mock('@/lib/supabase', () => ({ getSupabaseServer }));

const { GET } = await import('./route');
const { SUPPORTED_CHAIN_IDS } = await import('@/lib/chainPolicy');

const ORIG = { ...process.env };

function req(headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/cron/reconcile', { headers });
}

const auth = { authorization: 'Bearer sekret' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIG, CRON_SECRET: 'sekret' };
  reconcileStuckThreads.mockResolvedValue({ swept: 0, enqueued: 0, errors: [] });
  // Healthy balances by default so the reconcile-focused tests stay isolated.
  checkAgentWalletBalance.mockResolvedValue({ low: [], balances: { cUSD: 5, USDT: 5, USDC: 5 } });
  checkReserveBalance.mockResolvedValue({ low: [], balances: { cUSD: 5, USDT: 5, USDC: 5 } });
  checkOrchestratorGas.mockResolvedValue({
    low: false,
    warn: false,
    native: 1,
    requiredNative: 0.0000132,
    address: '0xEOA',
  });
  checkPreviewAlive.mockResolvedValue({ ok: true });
  claimAlertOnce.mockResolvedValue(true);
});

describe('GET /api/cron/reconcile', () => {
  it('503 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ authorization: 'Bearer sekret' }));
    expect(res.status).toBe(503);
    expect(reconcileStuckThreads).not.toHaveBeenCalled();
  });

  it('401 when the bearer token is missing or wrong', async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req({ authorization: 'Bearer nope' }))).status).toBe(401);
    expect(reconcileStuckThreads).not.toHaveBeenCalled();
  });

  it('runs reconcile and returns the summary on valid auth', async () => {
    reconcileStuckThreads.mockResolvedValue({ swept: 2, enqueued: 2, errors: [] });
    const res = await GET(req({ authorization: 'Bearer sekret' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 2, enqueued: 2, errors: [] });
    expect(reconcileStuckThreads).toHaveBeenCalledOnce();
  });

  it('alerts when threads were swept', async () => {
    reconcileStuckThreads.mockResolvedValue({ swept: 3, enqueued: 3, errors: [] });
    await GET(req({ authorization: 'Bearer sekret' }));
    expect(alertOps).toHaveBeenCalledOnce();
  });

  it('does not alert on a clean run (nothing swept, no errors)', async () => {
    await GET(req({ authorization: 'Bearer sekret' }));
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('alerts when reconcile reports errors even with nothing swept', async () => {
    reconcileStuckThreads.mockResolvedValue({
      swept: 0,
      enqueued: 0,
      errors: [{ stage: 'select', message: 'db down' }],
    });
    await GET(req({ authorization: 'Bearer sekret' }));
    expect(alertOps).toHaveBeenCalledOnce();
  });

  it('returns 500 and alerts when reconcile throws', async () => {
    reconcileStuckThreads.mockRejectedValue(new Error('boom'));
    const res = await GET(req({ authorization: 'Bearer sekret' }));
    expect(res.status).toBe(500);
    expect(alertOps).toHaveBeenCalledOnce();
  });

  it('alerts when the agent wallet is low and the throttle allows it', async () => {
    checkAgentWalletBalance.mockResolvedValue({ low: ['USDT'], balances: { cUSD: 5, USDT: 0.3, USDC: 5 } });
    await GET(req(auth));
    // Once per supported chain: each chain has its own wallet to top up.
    expect(alertOps).toHaveBeenCalledTimes(SUPPORTED_CHAIN_IDS.length);
    expect(alertOps.mock.calls[0][0]).toMatch(/balance low/i);
  });

  it('suppresses the wallet-low alert when the throttle denies it', async () => {
    checkAgentWalletBalance.mockResolvedValue({ low: ['USDT'], balances: { cUSD: 5, USDT: 0.3, USDC: 5 } });
    claimAlertOnce.mockResolvedValue(false);
    await GET(req(auth));
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('still returns 200 with the reconcile summary when the health check throws', async () => {
    checkAgentWalletBalance.mockRejectedValue(new Error('rpc down'));
    const res = await GET(req(auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 0, enqueued: 0, errors: [] });
  });

  it('alerts when the refund reserve is low', async () => {
    checkReserveBalance.mockResolvedValue({ low: ['cUSD'], balances: { cUSD: 0.1, USDT: 5, USDC: 5 } });
    await GET(req(auth));
    expect(alertOps).toHaveBeenCalledTimes(SUPPORTED_CHAIN_IDS.length);
    expect(alertOps.mock.calls[0][0]).toMatch(/reserve low/i);
  });

  it('still returns 200 when the reserve check throws', async () => {
    checkReserveBalance.mockRejectedValue(new Error('rpc down'));
    const res = await GET(req(auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 0, enqueued: 0, errors: [] });
  });
});

// A wallet full of stablecoins still settles nothing once the EOA that signs
// executeX402Call is out of native gas — and the ERC-20 heartbeat cannot see it.
describe('orchestrator gas heartbeat', () => {
  it('alerts when the signer is low on gas', async () => {
    checkOrchestratorGas.mockResolvedValue({ low: true, native: 0.004, address: '0xEOA' });
    await GET(req(auth));
    expect(alertOps).toHaveBeenCalledWith(
      expect.stringMatching(/low on gas/i),
      expect.objectContaining({ address: '0xEOA', native: 0.004 }),
    );
  });

  it('stays silent when the signer is funded', async () => {
    await GET(req(auth));
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('respects the throttle', async () => {
    checkOrchestratorGas.mockResolvedValue({ low: true, native: 0, address: '0xEOA' });
    claimAlertOnce.mockResolvedValue(false);
    await GET(req(auth));
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('never fails the reconcile job when the gas check throws', async () => {
    checkOrchestratorGas.mockRejectedValue(new Error('rpc down'));
    const res = await GET(req(auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 0, enqueued: 0, errors: [] });
  });

});

// The preview fails CLOSED and answers {available:false} with HTTP 200, so a
// dead landing looks like a healthy one. This heartbeat is the only thing that
// notices.
describe('preview heartbeat', () => {
  it('probes the public app URL a real visitor would hit', async () => {
    await GET(req(auth));
    expect(checkPreviewAlive).toHaveBeenCalledWith('https://app.test');
  });

  it('alerts when the preview is down', async () => {
    checkPreviewAlive.mockResolvedValue({ ok: false, reason: 'gate denied (available:false)' });
    await GET(req(auth));
    expect(alertOps).toHaveBeenCalledWith(
      expect.stringMatching(/preview is DOWN/i),
      expect.objectContaining({ reason: expect.stringMatching(/gate denied/) }),
    );
  });

  it('stays silent when the preview is healthy', async () => {
    await GET(req(auth));
    expect(alertOps).not.toHaveBeenCalled();
  });

  it('respects the throttle', async () => {
    checkPreviewAlive.mockResolvedValue({ ok: false, reason: 'HTTP 502' });
    claimAlertOnce.mockResolvedValue(false);
    await GET(req(auth));
    expect(alertOps).not.toHaveBeenCalled();
  });

  // The primary job is sweeping stuck (paid, undelivered) threads. A flaky
  // probe must never take that down.
  it('never fails the reconcile job when the probe throws', async () => {
    checkPreviewAlive.mockRejectedValue(new Error('network blew up'));
    const res = await GET(req(auth));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ swept: 0, enqueued: 0, errors: [] });
  });
});

// A chain nobody watches is a chain that quietly runs out of gas or reserve.
describe('multi-chain monitoring', () => {
  it('checks agent wallet, gas and reserve on every supported chain', async () => {
    await GET(req(auth));

    for (const spy of [checkAgentWalletBalance, checkOrchestratorGas, checkReserveBalance]) {
      const seen = spy.mock.calls.map((c) => c[0].chainId).sort((a, b) => a - b);
      expect(seen).toEqual([...SUPPORTED_CHAIN_IDS].sort((a, b) => a - b));
    }
  });

  // The alert keys already carry :chainId, so two low chains must page twice
  // rather than one silencing the other.
  it('claims a separate alert key per chain', async () => {
    checkAgentWalletBalance.mockResolvedValue({ low: ['USDC'], balances: { USDC: 0 } });

    await GET(req(auth));

    const keys = claimAlertOnce.mock.calls
      .map((c) => c[0])
      .filter((k: string) => k.startsWith('agent-wallet-low:'));
    expect(new Set(keys).size).toBe(SUPPORTED_CHAIN_IDS.length);
  });

  // One chain's RPC failing must not stop the others being checked.
  it('keeps checking the remaining chains when one chain throws', async () => {
    checkAgentWalletBalance.mockImplementation(async ({ chainId }: { chainId: number }) => {
      if (chainId === SUPPORTED_CHAIN_IDS[0]) throw new Error('rpc down');
      return { low: [], balances: {} };
    });

    const res = await GET(req(auth));

    expect(res.status).toBe(200);
    expect(checkAgentWalletBalance).toHaveBeenCalledTimes(SUPPORTED_CHAIN_IDS.length);
  });
});
