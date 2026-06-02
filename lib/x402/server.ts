import { HTTPFacilitatorClient } from '@x402/core/server';
import { x402ResourceServer } from '@x402/next';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { getX402ChainConfig } from './config';

let cached: ReturnType<typeof build> | null = null;

function build() {
  // Testnet (Base Sepolia): the x402.org facilitator needs no auth.
  // Mainnet (Base): set X402_FACILITATOR_URL to the Coinbase CDP facilitator and
  // X402_FACILITATOR_TOKEN to a bearer token (CDP key), see .env.example.
  const url = process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator';
  const token = process.env.X402_FACILITATOR_TOKEN;

  const facilitator = new HTTPFacilitatorClient({
    url,
    ...(token
      ? {
          createAuthHeaders: async () => ({
            verify: { Authorization: `Bearer ${token}` },
            settle: { Authorization: `Bearer ${token}` },
            supported: { Authorization: `Bearer ${token}` },
          }),
        }
      : {}),
  });

  const caip2 = getX402ChainConfig(Number(process.env.X402_CHAIN_ID || '84532')).caip2;
  return new x402ResourceServer(facilitator).register(caip2, new ExactEvmScheme());
}

export function getResourceServer() {
  if (!cached) cached = build();
  return cached;
}
