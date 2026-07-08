import { parseUnits, type Address } from 'viem';

export type SettleMode = 'legacy' | 'x402';

export interface X402ChainConfig {
  caip2: `eip155:${number}`;
  usdc: Address;
  usdcDecimals: number;
}

// Single source of truth for the x402 Groq price (human USDC). The displayed
// cost derives from this, so it cannot drift from what settles.
export const X402_PRICE_USD = '0.001';
export const X402_PRICE_LABEL = `$${X402_PRICE_USD}`; // withX402 `price` form

// Groq model used by both the x402 proxy and the legacy pipeline. One source so
// a model rotation can't leave the two settlement paths on different models.
export const GROQ_MODEL = 'llama-3.3-70b-versatile';

const BASE_MAINNET = 8453;
const BASE_SEPOLIA = 84532;

const CONFIG: Record<number, X402ChainConfig> = {
  [BASE_MAINNET]: {
    caip2: 'eip155:8453',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcDecimals: 6,
  },
  [BASE_SEPOLIA]: {
    caip2: 'eip155:84532',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcDecimals: 6,
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
// is a supported Base chain; everything else stays legacy. Deliberately NOT
// keyed on the user's payment chain: MiniPay users pay on Celo while the
// agent's own Groq spend settles on Base (Model 2, spec
// docs/superpowers/specs/2026-07-08-model2-x402-all-threads-design.md).
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

export function priceRawUSDC(): bigint {
  return parseUnits(X402_PRICE_USD, 6);
}

export function dailyCapRawUSDC(): bigint {
  return parseUnits(process.env.X402_DAILY_CAP_USDC || '5', 6);
}
