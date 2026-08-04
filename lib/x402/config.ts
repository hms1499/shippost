import { parseUnits, type Address } from 'viem';

export type SettleMode = 'legacy' | 'x402';

export interface X402ChainConfig {
  caip2: `eip155:${number}`;
  usdc: Address;
  usdcDecimals: number;
  /**
   * EIP-712 domain of `usdc`, as the token contract declares it. The client
   * signs the EIP-3009 authorization against this, so it travels with the
   * price in the 402 challenge (see `priceForChain`).
   */
  eip712: { name: string; version: string };
  /**
   * Bare network name for a facilitator still serving x402 v1. Set only where
   * the facilitator cannot speak v2 — its presence is what makes the resource
   * server wrap the facilitator in the v1 downgrade shim. Delete it and the
   * chain goes back to plain v2 with no other change.
   */
  v1Network?: string;
}

// Single source of truth for the x402 Groq price (human USDC). The displayed
// cost derives from this, so it cannot drift from what settles.
export const X402_PRICE_USD = '0.001';

// Groq model used by both the x402 proxy and the legacy pipeline. One source so
// a model rotation can't leave the two settlement paths on different models.
export const GROQ_MODEL = 'llama-3.3-70b-versatile';

const BASE_MAINNET = 8453;
const BASE_SEPOLIA = 84532;
const CELO_MAINNET = 42220;
const CELO_SEPOLIA = 11142220;

const CONFIG: Record<number, X402ChainConfig> = {
  [BASE_MAINNET]: {
    caip2: 'eip155:8453',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcDecimals: 6,
    eip712: { name: 'USD Coin', version: '2' },
  },
  [BASE_SEPOLIA]: {
    caip2: 'eip155:84532',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcDecimals: 6,
    eip712: { name: 'USDC', version: '2' },
  },
  // Celo. USDC here is Circle's native issuance and supports EIP-3009 with the
  // EIP-712 domain name "USDC" version "2" — which is what the exact scheme
  // signs — so no client-side change is needed to settle here.
  [CELO_MAINNET]: {
    caip2: 'eip155:42220',
    usdc: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    usdcDecimals: 6,
    eip712: { name: 'USDC', version: '2' },
    v1Network: 'celo',
  },
  [CELO_SEPOLIA]: {
    caip2: 'eip155:11142220',
    usdc: '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
    usdcDecimals: 6,
    eip712: { name: 'USDC', version: '2' },
    v1Network: 'celo-sepolia',
  },
};

export function getX402ChainConfig(chainId: number): X402ChainConfig {
  const c = CONFIG[chainId];
  if (!c) throw new Error(`no x402 config for chain ${chainId}`);
  return c;
}

export function isX402Chain(chainId: number): boolean {
  return chainId in CONFIG;
}

// x402 only when explicitly enabled AND the settlement chain (X402_CHAIN_ID)
// is a configured chain; everything else stays legacy. Deliberately NOT keyed
// on the user's payment chain — that stays Celo either way (Model 1). The
// settle chain is an independent choice: Base via the Coinbase CDP
// facilitator, or Celo via the hosted Celo facilitator (Model 2, specs
// docs/superpowers/specs/2026-07-08-model2-x402-all-threads-design.md and
// docs/superpowers/specs/2026-08-01-x402-celo-facilitator-design.md).
export function getSettleMode(): SettleMode {
  return process.env.X402_SETTLE_MODE === 'x402' && isX402Chain(getSettleChainId())
    ? 'x402'
    : 'legacy';
}

// The chain the agent's x402 spend settles on — NOT the payment chain. NaN
// when X402_CHAIN_ID is unset/garbage; isX402Chain(NaN) is false, so the mode
// degrades to legacy instead of throwing.
export function getSettleChainId(): number {
  return Number(process.env.X402_CHAIN_ID);
}

// The x402 price as an explicit asset + atomic amount, never a money string.
// A money string makes @x402/evm resolve the token through its own
// DEFAULT_STABLECOINS table, which covers Base but not Celo — on Celo it threw
// "No default asset configured for network eip155:42220" while building the 402
// challenge, and the pipeline degraded to legacy without ever paying x402.
export function priceForChain(chainId: number): {
  asset: Address;
  amount: string;
  extra: { name: string; version: string };
} {
  const cfg = getX402ChainConfig(chainId);
  return {
    asset: cfg.usdc,
    amount: parseUnits(X402_PRICE_USD, cfg.usdcDecimals).toString(),
    extra: cfg.eip712,
  };
}

export function priceRawUSDC(): bigint {
  return parseUnits(X402_PRICE_USD, 6);
}

export function dailyCapRawUSDC(): bigint {
  return parseUnits(process.env.X402_DAILY_CAP_USDC || '5', 6);
}
