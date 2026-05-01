import { celo } from 'wagmi/chains';
import type { Address } from 'viem';
import { celoSepolia } from './wagmi';

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

// Celo Sepolia testnet — MockERC20 addresses from deployments/celoSepolia.json
export const CELO_SEPOLIA_TOKENS: Record<TokenSymbol, TokenConfig> = {
  cUSD: {
    symbol: 'cUSD',
    address: '0xb7e155e9d4ab5a97f950c3259dace91b0f6c33f5',
    decimals: 18,
    displayName: 'Mock Celo Dollar',
  },
  USDT: {
    symbol: 'USDT',
    address: '0xd589cc6f20103401c1e168b9d2b3075e8b5fabca',
    decimals: 6,
    displayName: 'Mock USDT',
  },
  USDC: {
    symbol: 'USDC',
    address: '0x6bba6a2326fd6ab4694de5c9369001d7a3720dc1',
    decimals: 6,
    displayName: 'Mock USDC',
  },
};

export function getTokens(chainId: number): Record<TokenSymbol, TokenConfig> {
  if (chainId === celo.id) return CELO_MAINNET_TOKENS;
  if (chainId === celoSepolia.id) return CELO_SEPOLIA_TOKENS;
  throw new Error(`Unsupported chain: ${chainId}`);
}

export const THREAD_PRICE_USD = 0.05;

export function computeTokenAmount(token: TokenConfig): bigint {
  // 0.05 * 10^decimals
  // cUSD (18 dec): 5 * 10^16 = 50_000_000_000_000_000
  // USDT/USDC (6 dec): 5 * 10^4 = 50_000
  return BigInt(5) * BigInt(10) ** BigInt(token.decimals - 2);
}
