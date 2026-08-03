import { HTTPFacilitatorClient } from '@x402/core/server';
import { x402ResourceServer } from '@x402/next';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { getX402ChainConfig } from './config';
import { V1DowngradeFacilitator } from './facilitator-v1';

let cached: ReturnType<typeof build> | null = null;

type AuthHeaders = { verify: Record<string, string>; settle: Record<string, string>; supported: Record<string, string> };

// Per-operation facilitator auth. The x402 core calls this fresh on every
// verify/settle (see HTTPFacilitatorClient), so request-scoped, short-lived
// tokens never go stale.
//
// CDP (Base mainnet): the Coinbase facilitator rejects a static bearer — it
// needs a JWT whose host+method+path are baked in (~2min TTL). We mint one per
// operation against the facilitator's own base path. generateJwt is imported
// lazily so the testnet path (and tests) don't load the CDP SDK.
//
// Static bearer fallback (X402_FACILITATOR_TOKEN): kept for any facilitator that
// does use a static token. Testnet x402.org needs no auth → undefined.
function buildAuthHeaders(facilitatorUrl: string): (() => Promise<AuthHeaders>) | undefined {
  const apiKeyId = process.env.CDP_API_KEY_ID;
  const apiKeySecret = process.env.CDP_API_KEY_SECRET;

  if (apiKeyId && apiKeySecret) {
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

  const token = process.env.X402_FACILITATOR_TOKEN;
  if (token) {
    const h = { Authorization: `Bearer ${token}` };
    return async () => ({ verify: h, settle: h, supported: h });
  }

  return undefined;
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
