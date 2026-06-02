import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const reserveDailySpend = vi.fn();
const isPaused = vi.fn();
const payFetch = vi.fn();

vi.mock('./cap', () => ({ reserveDailySpend, isPaused }));
vi.mock('./config', async (orig) => ({
  ...(await orig<typeof import('./config')>()),
}));
vi.mock('@x402/fetch', () => ({
  x402Client: class {},
  wrapFetchWithPayment: () => payFetch,
}));
vi.mock('@x402/evm/exact/client', () => ({ registerExactEvmScheme: vi.fn() }));
vi.mock('viem/accounts', () => ({ privateKeyToAccount: () => ({ address: '0xagent' }) }));

const { payGroqViaX402 } = await import('./client');

const PAYMENT_RESPONSE = Buffer.from(
  JSON.stringify({ transaction: '0xsettletx' }),
).toString('base64');

function res(body: unknown, status = 200, header = PAYMENT_RESPONSE) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: {
      get: (k: string) =>
        ['payment-response', 'x-payment-response'].includes(k.toLowerCase()) ? header : null,
    },
  };
}

const params = {
  chainId: 84532,
  messages: [{ role: 'user' as const, content: 'hi' }],
  temperature: 0.7,
  maxTokens: 1200,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AGENT_WALLET_PRIVATE_KEY', '0x' + '1'.repeat(64));
  vi.stubEnv('X402_PROXY_BASE_URL', 'https://proxy.test');
  vi.stubEnv('X402_DAILY_CAP_USDC', '5');
  isPaused.mockResolvedValue(false);
  reserveDailySpend.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('payGroqViaX402', () => {
  it('reserves cap, pays the proxy, returns tweets + settlement tx hash', async () => {
    payFetch.mockResolvedValue(res({ tweets: ['t1', 't2'] }));
    const out = await payGroqViaX402(params);
    expect(reserveDailySpend).toHaveBeenCalledOnce();
    expect(out.tweets).toEqual(['t1', 't2']);
    expect(out.settlementTxHash).toBe('0xsettletx');
    const [url, init] = payFetch.mock.calls[0];
    expect(url).toBe('https://proxy.test/api/x402/groq');
    expect(JSON.parse(init.body)).toMatchObject({ messages: params.messages });
  });

  it('fails fast (before guards) when AGENT_WALLET_PRIVATE_KEY is absent', async () => {
    vi.stubEnv('AGENT_WALLET_PRIVATE_KEY', '');
    await expect(payGroqViaX402(params)).rejects.toThrow('AGENT_WALLET_PRIVATE_KEY');
    expect(isPaused).not.toHaveBeenCalled();
    expect(reserveDailySpend).not.toHaveBeenCalled();
    expect(payFetch).not.toHaveBeenCalled();
  });

  it('throws and never pays when paused', async () => {
    isPaused.mockResolvedValue(true);
    await expect(payGroqViaX402(params)).rejects.toThrow('paused');
    expect(reserveDailySpend).not.toHaveBeenCalled();
    expect(payFetch).not.toHaveBeenCalled();
  });

  it('throws and never pays when the cap is exceeded', async () => {
    reserveDailySpend.mockRejectedValue(new Error('x402 daily spend cap exceeded'));
    await expect(payGroqViaX402(params)).rejects.toThrow('cap exceeded');
    expect(payFetch).not.toHaveBeenCalled();
  });

  it('throws on a non-OK proxy response (no content leaked)', async () => {
    payFetch.mockResolvedValue(res({ error: 'invalid thread' }, 422));
    await expect(payGroqViaX402(params)).rejects.toThrow('422');
  });

  it('throws when the proxy returns no tweets', async () => {
    payFetch.mockResolvedValue(res({ tweets: [] }));
    await expect(payGroqViaX402(params)).rejects.toThrow('no tweets');
  });
});
