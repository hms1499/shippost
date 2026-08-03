import { HTTPFacilitatorClient } from '@x402/core/server';
import { x402ResourceServer } from '@x402/next';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { getX402ChainConfig } from './config';
import { V1DowngradeFacilitator } from './facilitator-v1';

let cached: ReturnType<typeof build> | null = null;

type AuthHeaders = { verify: Record<string, string>; settle: Record<string, string>; supported: Record<string, string> };

type AuthScheme = 'cdp' | 'api-key' | 'bearer' | 'none';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for X402_FACILITATOR_AUTH=${process.env.X402_FACILITATOR_AUTH}`);
  return v;
}

// Which facilitator auth to use, named rather than inferred. Inference was a
// trap: CDP creds outlive a chain switch, so a Celo facilitator URL would still
// get Coinbase JWTs and fail as if the facilitator were down. Unset keeps the
// old precedence so existing deployments are unaffected.
function resolveScheme(): AuthScheme {
  const raw = process.env.X402_FACILITATOR_AUTH;
  if (!raw) {
    if (process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET) return 'cdp';
    if (process.env.X402_FACILITATOR_TOKEN) return 'bearer';
    return 'none';
  }
  if (raw === 'cdp' || raw === 'api-key' || raw === 'bearer' || raw === 'none') return raw;
  throw new Error(`X402_FACILITATOR_AUTH must be cdp | api-key | bearer | none (got "${raw}")`);
}

// Per-operation facilitator auth. The x402 core calls this fresh on every
// verify/settle (see HTTPFacilitatorClient), so request-scoped, short-lived
// tokens never go stale.
function buildAuthHeaders(facilitatorUrl: string): (() => Promise<AuthHeaders>) | undefined {
  const scheme = resolveScheme();

  if (scheme === 'none') return undefined;

  // CDP (Base mainnet): the Coinbase facilitator rejects a static bearer — it
  // needs a JWT whose host+method+path are baked in (~2min TTL). We mint one per
  // operation against the facilitator's own base path. generateJwt is imported
  // lazily so the other paths (and tests) don't load the CDP SDK.
  if (scheme === 'cdp') {
    const apiKeyId = requireEnv('CDP_API_KEY_ID');
    const apiKeySecret = requireEnv('CDP_API_KEY_SECRET');
    const u = new URL(facilitatorUrl);
    const host = u.host;
    const base = u.pathname.replace(/\/$/, '');
    return async () => {
      const { generateJwt } = await import('@coinbase/cdp-sdk/auth');
      const bearer = async (requestMethod: string, requestPath: string) => ({
        Authorization: `Bearer ${await generateJwt({ apiKeyId, apiKeySecret, requestMethod, requestHost: host, requestPath })}`,
      });
      const [verify, settle, supported] = await Promise.all([
        bearer('POST', `${base}/verify`),
        bearer('POST', `${base}/settle`),
        bearer('GET', `${base}/supported`),
      ]);
      return { verify, settle, supported };
    };
  }

  // Celo's hosted facilitator meters prepaid credits against an API key, and
  // sends it under X-API-Key rather than Authorization. Same header on every
  // operation — unlike the CDP JWT it is not scoped to a path.
  if (scheme === 'api-key') {
    const h = { 'X-API-Key': requireEnv('X402_FACILITATOR_API_KEY') };
    return async () => ({ verify: h, settle: h, supported: h });
  }

  const h = { Authorization: `Bearer ${requireEnv('X402_FACILITATOR_TOKEN')}` };
  return async () => ({ verify: h, settle: h, supported: h });
}

function build() {
  // Testnet (Base Sepolia): the x402.org facilitator needs no auth.
  // Mainnet (Base): X402_FACILITATOR_URL = CDP facilitator
  // (https://api.cdp.coinbase.com/platform/v2/x402) + CDP_API_KEY_ID/SECRET.
  const url = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
  const createAuthHeaders = buildAuthHeaders(url);

  const http = new HTTPFacilitatorClient({
    url,
    ...(createAuthHeaders ? { createAuthHeaders } : {}),
  });

  const cfg = getX402ChainConfig(Number(process.env.X402_CHAIN_ID || '84532'));

  // A chain carrying a bare network name has a facilitator stuck on x402 v1
  // (Celo's, today). Translate at this boundary only — everything above keeps
  // speaking v2, so dropping v1Network from the chain table is the whole
  // rollback. See lib/x402/facilitator-v1.ts.
  const facilitator = cfg.v1Network
    ? new V1DowngradeFacilitator(http, {
        caip2: cfg.caip2,
        v1Network: cfg.v1Network,
        resourceUrl: `${process.env.NEXT_PUBLIC_APP_URL || 'https://shippost-kappa.vercel.app'}/api/x402/groq`,
      })
    : http;

  return new x402ResourceServer(facilitator).register(cfg.caip2, new ExactEvmScheme());
}

export function getResourceServer() {
  if (!cached) cached = build();
  return cached;
}
