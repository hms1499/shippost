import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the config handed to HTTPFacilitatorClient so we can drive its
// createAuthHeaders without a real facilitator.
const captured: {
  config?: { url: string; createAuthHeaders?: () => Promise<unknown> };
  facilitator?: unknown;
} = {};

vi.mock('@x402/core/server', () => ({
  HTTPFacilitatorClient: class {
    constructor(config: { url: string; createAuthHeaders?: () => Promise<unknown> }) {
      captured.config = config;
    }
  },
}));
vi.mock('@x402/next', () => ({
  x402ResourceServer: class {
    constructor(facilitator: unknown) {
      captured.facilitator = facilitator;
    }
    register() {
      return this;
    }
  },
}));
vi.mock('@x402/evm/exact/server', () => ({ ExactEvmScheme: class {} }));

const generateJwt = vi.fn(
  async ({ requestMethod, requestPath }: { requestMethod: string; requestPath: string }) =>
    `jwt:${requestMethod}:${requestPath}`,
);
vi.mock('@coinbase/cdp-sdk/auth', () => ({ generateJwt: (...a: unknown[]) => generateJwt(...(a as [never])) }));

const ENV = { ...process.env };

describe('getResourceServer facilitator auth', () => {
  beforeEach(() => {
    vi.resetModules();
    captured.config = undefined;
    captured.facilitator = undefined;
    generateJwt.mockClear();
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
    delete process.env.X402_FACILITATOR_URL;
    delete process.env.X402_FACILITATOR_TOKEN;
    process.env.X402_CHAIN_ID = '8453';
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it('testnet: no CDP keys, no token → no auth headers', async () => {
    const { getResourceServer } = await import('./server');
    getResourceServer();
    expect(captured.config?.url).toBe('https://x402.org/facilitator');
    expect(captured.config?.createAuthHeaders).toBeUndefined();
  });

  it('CDP: mints a request-scoped JWT per operation against the facilitator base path', async () => {
    process.env.CDP_API_KEY_ID = 'key-id';
    process.env.CDP_API_KEY_SECRET = 'key-secret';
    process.env.X402_FACILITATOR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402';

    const { getResourceServer } = await import('./server');
    getResourceServer();

    expect(captured.config?.url).toBe('https://api.cdp.coinbase.com/platform/v2/x402');
    const headers = (await captured.config!.createAuthHeaders!()) as {
      verify: Record<string, string>;
      settle: Record<string, string>;
      supported: Record<string, string>;
    };

    expect(headers.verify.Authorization).toBe('Bearer jwt:POST:/platform/v2/x402/verify');
    expect(headers.settle.Authorization).toBe('Bearer jwt:POST:/platform/v2/x402/settle');
    expect(headers.supported.Authorization).toBe('Bearer jwt:GET:/platform/v2/x402/supported');

    // host derived from the configured URL, not hardcoded
    expect(generateJwt).toHaveBeenCalledWith(
      expect.objectContaining({ requestHost: 'api.cdp.coinbase.com', apiKeyId: 'key-id', apiKeySecret: 'key-secret' }),
    );
  });

  it('static bearer fallback when only X402_FACILITATOR_TOKEN is set', async () => {
    process.env.X402_FACILITATOR_TOKEN = 'static-tok';
    const { getResourceServer } = await import('./server');
    getResourceServer();
    const headers = (await captured.config!.createAuthHeaders!()) as { verify: Record<string, string> };
    expect(headers.verify.Authorization).toBe('Bearer static-tok');
    expect(generateJwt).not.toHaveBeenCalled();
  });
});

describe('getResourceServer facilitator selection', () => {
  beforeEach(() => {
    vi.resetModules();
    captured.config = undefined;
    captured.facilitator = undefined;
    delete process.env.CDP_API_KEY_ID;
    delete process.env.CDP_API_KEY_SECRET;
    delete process.env.X402_FACILITATOR_URL;
  });
  afterEach(() => {
    process.env = { ...ENV };
  });

  it('Base: hands the facilitator to the resource server untouched', async () => {
    process.env.X402_CHAIN_ID = '8453';
    const { getResourceServer } = await import('./server');
    getResourceServer();

    const { V1DowngradeFacilitator } = await import('./facilitator-v1');
    expect(captured.facilitator).not.toBeInstanceOf(V1DowngradeFacilitator);
  });

  it('Celo: wraps the facilitator in the v1 downgrade shim', async () => {
    process.env.X402_CHAIN_ID = '42220';
    const { getResourceServer } = await import('./server');
    getResourceServer();

    const { V1DowngradeFacilitator } = await import('./facilitator-v1');
    expect(captured.facilitator).toBeInstanceOf(V1DowngradeFacilitator);
  });

  it('Celo Sepolia: wraps it too, so the shim can be proven off mainnet', async () => {
    process.env.X402_CHAIN_ID = '11142220';
    const { getResourceServer } = await import('./server');
    getResourceServer();

    const { V1DowngradeFacilitator } = await import('./facilitator-v1');
    expect(captured.facilitator).toBeInstanceOf(V1DowngradeFacilitator);
  });
});
