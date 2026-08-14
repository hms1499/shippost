import { celo, base, baseSepolia } from 'wagmi/chains';
import { parseUnits, type Address } from 'viem';
import { celoSepolia } from './chains';

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

// Base mainnet. USDC only for now: USDT on Base is deliberately out of scope
// until its address is verified on-chain — an unverified token address reaching
// setAllowedToken on mainnet is the expensive class of mistake.
export const BASE_MAINNET_TOKENS: Partial<Record<TokenSymbol, TokenConfig>> = {
  USDC: {
    symbol: 'USDC',
    address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    decimals: 6,
    displayName: 'USD Coin',
  },
};

// Base Sepolia — Circle's testnet USDC, used for the step-3 dry run.
export const BASE_SEPOLIA_TOKENS: Partial<Record<TokenSymbol, TokenConfig>> = {
  USDC: {
    symbol: 'USDC',
    address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    decimals: 6,
    displayName: 'USD Coin',
  },
};

// Partial, not Record: Base has no cUSD, so callers must handle a missing
// symbol rather than assume all three exist on every chain.
export function getTokens(chainId: number): Partial<Record<TokenSymbol, TokenConfig>> {
  if (chainId === base.id) return BASE_MAINNET_TOKENS;
  if (chainId === baseSepolia.id) return BASE_SEPOLIA_TOKENS;
  if (chainId === celo.id) return CELO_MAINNET_TOKENS;
  if (chainId === celoSepolia.id) return CELO_SEPOLIA_TOKENS;
  throw new Error(`Unsupported chain: ${chainId}`);
}

// Display/fallback only. The authoritative price is requiredAmount(token) read
// from the contract (see lib/threadPrice.ts) — the on-chain price is settable,
// so anything computed locally can be stale.
export const THREAD_PRICE_USD = 0.1;

// One label for every price shown in copy. It was six hardcoded "$0.05" strings
// before, which is six places to miss on a repricing. Still display-only: the
// authoritative price is the contract's, so this can lag a setPrice — what the
// user is actually charged comes from readThreadPrice, never from here.
export const THREAD_PRICE_LABEL = `$${THREAD_PRICE_USD.toFixed(2)}`;

export function computeTokenAmount(token: TokenConfig): bigint {
  return parseUnits(String(THREAD_PRICE_USD), token.decimals);
}

// Every simulated x402 micro-charge (Serper grounding, FactCheck, the Groq
// legacy settle) costs this much, in USD. Single source so the on-chain amount
// that settles and the cost shown to the user can never drift apart.
export const X402_UNIT_COST_USD = '0.001';

// The x402 micro-charge in a token's own base units. The AgentWallet spends the
// SAME token the user paid with (each thread self-funds from the 50% split), so
// the amount must scale to that token's decimals — parseUnits keeps 6-decimal
// USDT/USDC and 18-decimal cUSD correct. Never hardcode 1e15: for USDT that
// would be 1e9 tokens, blowing the balance and the daily cap.
export function computeX402CostAmount(token: TokenConfig): bigint {
  return parseUnits(X402_UNIT_COST_USD, token.decimals);
}
