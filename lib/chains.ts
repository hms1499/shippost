import { celo, base, baseSepolia } from 'wagmi/chains';
import { defineChain } from 'viem';

export const celoSepolia = defineChain({
  id: 11142220,
  name: 'Celo Sepolia',
  nativeCurrency: { name: 'CELO', symbol: 'CELO', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://forno.celo-sepolia.celo-testnet.org'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://celo-sepolia.blockscout.com' },
  },
  testnet: true,
});

// Which chains exist. Which ones this deployment ACCEPTS is a separate
// question, answered by lib/chainPolicy.ts — two sources of truth for
// "supported" is how a chain gets accepted in one layer and rejected in
// another.
export function getChain(chainId: number) {
  if (chainId === base.id) return base;
  if (chainId === baseSepolia.id) return baseSepolia;
  if (chainId === celo.id) return celo;
  if (chainId === celoSepolia.id) return celoSepolia;
  throw new Error(`Unsupported chain ${chainId}`);
}

export function explorerBase(chainId: number | undefined): string {
  if (chainId === base.id) return 'https://basescan.org';
  if (chainId === baseSepolia.id) return 'https://sepolia.basescan.org';
  if (chainId === celo.id) return 'https://celoscan.io';
  return 'https://celo-sepolia.blockscout.com';
}
