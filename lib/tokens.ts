import { celo, celoAlfajores } from 'wagmi/chains';
import type { Address } from 'viem';

export type TokenSymbol = 'cUSD' | 'USDT' | 'USDC';

export interface TokenConfig {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
  displayName: string;
}

export const CELO_MAINNET_TOKENS: Record<TokenSymbol, TokenConfig> = {
  cUSD: {
    symbol: 'cUSD',
    address: '0x765DE816845861e75A25fCA122bb6898B8B1282a',
    decimals: 18,
    displayName: 'Celo Dollar',
  },
  USDT: {
    symbol: 'USDT',
    address: '0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e',
    decimals: 6,
    displayName: 'Tether USD',
  },
  USDC: {
    symbol: 'USDC',
    address: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
    decimals: 6,
    displayName: 'USD Coin',
  },
};

// Alfajores testnet — MockERC20 addresses filled in after Task 15 deploy.
export const CELO_ALFAJORES_TOKENS: Record<TokenSymbol, TokenConfig> = {
  cUSD: {
    symbol: 'cUSD',
    address: '0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1',
    decimals: 18,
    displayName: 'Celo Dollar (testnet)',
  },
  USDT: {
    symbol: 'USDT',
    address: '0x0000000000000000000000000000000000000000', // placeholder until Task 15
    decimals: 6,
    displayName: 'Mock USDT',
  },
  USDC: {
    symbol: 'USDC',
    address: '0x0000000000000000000000000000000000000000', // placeholder until Task 15
    decimals: 6,
    displayName: 'Mock USDC',
  },
};

export function getTokens(chainId: number): Record<TokenSymbol, TokenConfig> {
  if (chainId === celo.id) return CELO_MAINNET_TOKENS;
  if (chainId === celoAlfajores.id) return CELO_ALFAJORES_TOKENS;
  throw new Error(`Unsupported chain: ${chainId}`);
}

export const THREAD_PRICE_USD = 0.05;

export function computeTokenAmount(token: TokenConfig): bigint {
  // 0.05 * 10^decimals
  // cUSD (18 dec): 5 * 10^16 = 50_000_000_000_000_000
  // USDT/USDC (6 dec): 5 * 10^4 = 50_000
  return BigInt(5) * BigInt(10) ** BigInt(token.decimals - 2);
}
