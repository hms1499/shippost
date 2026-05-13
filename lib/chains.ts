import { celo } from 'wagmi/chains';
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

export function getChain(chainId: number) {
  if (chainId === celoSepolia.id) return celoSepolia;
  if (chainId === celo.id) return celo;
  throw new Error(`Unsupported chain ${chainId}`);
}

export function explorerBase(chainId: number | undefined): string {
  if (chainId === celo.id) return 'https://celoscan.io';
  return 'https://celo-sepolia.blockscout.com';
}

export const SUPPORTED_CHAIN_IDS = [celoSepolia.id, celo.id] as const;

export function isSupportedChain(chainId: number | undefined): boolean {
  if (chainId === undefined) return false;
  return (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
}
