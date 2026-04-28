import type { Address } from 'viem';
import { celo } from 'wagmi/chains';
import { celoSepolia } from './wagmi';
import paymentArtifact from '@/artifacts/contracts/ShipPostPayment.sol/ShipPostPayment.json';
import agentArtifact from '@/artifacts/contracts/AgentWallet.sol/AgentWallet.json';

export const shipPostPaymentAbi = paymentArtifact.abi;
export const agentWalletAbi = agentArtifact.abi;

export interface ContractAddresses {
  ShipPostPayment: Address;
  AgentWallet: Address;
}

export const CONTRACTS: Record<number, ContractAddresses> = {
  [celoSepolia.id]: {
    ShipPostPayment: (process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_TESTNET ?? '0x12da5404e73fbdb21908f598eebbd552f6172a65') as Address,
    AgentWallet: (process.env.NEXT_PUBLIC_AGENT_WALLET_TESTNET ?? '0xe5adff43dd082cbd15759e6a21a4880a33cc48a5') as Address,
  },
  [celo.id]: {
    // Filled in Week 2 mainnet deploy
    ShipPostPayment: (process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_MAINNET ?? '0x0000000000000000000000000000000000000000') as Address,
    AgentWallet: (process.env.NEXT_PUBLIC_AGENT_WALLET_MAINNET ?? '0x0000000000000000000000000000000000000000') as Address,
  },
};

export function getContracts(chainId: number): ContractAddresses {
  const c = CONTRACTS[chainId];
  if (!c) throw new Error(`No contracts for chain ${chainId}`);
  return c;
}
