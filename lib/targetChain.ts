import { celo } from 'wagmi/chains';
import { celoSepolia } from './chains';

// NEXT_PUBLIC_TARGET_CHAIN_ID controls which chain the app operates on.
// Production (Vercel): 42220 (Celo mainnet)
// Staging / Preview:   11142220 (Celo Sepolia testnet)
// Unset → defaults to mainnet.
type SupportedChainId = typeof celo.id | typeof celoSepolia.id;

const rawId = process.env.NEXT_PUBLIC_TARGET_CHAIN_ID;
const parsed = rawId ? parseInt(rawId, 10) : celo.id;

export const TARGET_CHAIN_ID: SupportedChainId =
  parsed === celoSepolia.id ? celoSepolia.id : celo.id;

export function getTargetChain() {
  if (TARGET_CHAIN_ID === celoSepolia.id) return celoSepolia;
  return celo;
}

export function targetChainName(): string {
  if (TARGET_CHAIN_ID === celoSepolia.id) return 'Celo Sepolia (testnet)';
  return 'Celo';
}
