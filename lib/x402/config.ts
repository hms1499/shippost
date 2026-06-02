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

// x402 only when explicitly enabled AND on a supported (Base) chain; everything
// else stays on legacy push-to-sink (Celo/MiniPay untouched).
export function getSettleMode(chainId: number): SettleMode {
  return process.env.X402_SETTLE_MODE === 'x402' && isX402Chain(chainId)
    ? 'x402'
    : 'legacy';
}

export function priceRawUSDC(): bigint {
  return parseUnits(X402_PRICE_USD, 6);
}

export function dailyCapRawUSDC(): bigint {
  return parseUnits(process.env.X402_DAILY_CAP_USDC || '5', 6);
}
