import type { Address } from 'viem';
import { celo } from 'wagmi/chains';
import { celoSepolia } from './wagmi';

export const shipPostPaymentAbi = [
  { inputs: [{ internalType: 'address', name: '_agentWallet', type: 'address' }, { internalType: 'address', name: '_treasury', type: 'address' }, { internalType: 'address', name: '_reservePool', type: 'address' }], stateMutability: 'nonpayable', type: 'constructor' },
  { inputs: [], name: 'EnforcedPause', type: 'error' },
  { inputs: [], name: 'ExpectedPause', type: 'error' },
  { inputs: [{ internalType: 'address', name: 'owner', type: 'address' }], name: 'OwnableInvalidOwner', type: 'error' },
  { inputs: [{ internalType: 'address', name: 'account', type: 'address' }], name: 'OwnableUnauthorizedAccount', type: 'error' },
  { inputs: [], name: 'ReentrancyGuardReentrantCall', type: 'error' },
  { anonymous: false, inputs: [{ indexed: false, internalType: 'uint256', name: 'agentBp', type: 'uint256' }, { indexed: false, internalType: 'uint256', name: 'treasuryBp', type: 'uint256' }, { indexed: false, internalType: 'uint256', name: 'reserveBp', type: 'uint256' }], name: 'FeeSplitUpdated', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, internalType: 'address', name: 'previousOwner', type: 'address' }, { indexed: true, internalType: 'address', name: 'newOwner', type: 'address' }], name: 'OwnershipTransferred', type: 'event' },
  { anonymous: false, inputs: [{ indexed: false, internalType: 'address', name: 'account', type: 'address' }], name: 'Paused', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, internalType: 'address', name: 'user', type: 'address' }, { indexed: true, internalType: 'uint256', name: 'threadId', type: 'uint256' }, { indexed: false, internalType: 'uint8', name: 'mode', type: 'uint8' }, { indexed: false, internalType: 'address', name: 'token', type: 'address' }, { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }], name: 'ThreadRequested', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, internalType: 'address', name: 'token', type: 'address' }, { indexed: false, internalType: 'bool', name: 'allowed', type: 'bool' }], name: 'TokenAllowed', type: 'event' },
  { anonymous: false, inputs: [{ indexed: false, internalType: 'address', name: 'account', type: 'address' }], name: 'Unpaused', type: 'event' },
  { inputs: [], name: 'agentBp', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'agentWallet', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: '', type: 'address' }], name: 'allowedTokens', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'owner', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'paused', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'token', type: 'address' }, { internalType: 'uint8', name: 'mode', type: 'uint8' }], name: 'payForThread', outputs: [{ internalType: 'uint256', name: 'threadId', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'renounceOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'token', type: 'address' }], name: 'requiredAmount', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'reserveBp', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'reservePool', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'token', type: 'address' }, { internalType: 'bool', name: 'allowed', type: 'bool' }], name: 'setAllowedToken', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'threadCounter', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'newOwner', type: 'address' }], name: 'transferOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'treasury', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'treasuryBp', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'unpause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: '_agentBp', type: 'uint256' }, { internalType: 'uint256', name: '_treasuryBp', type: 'uint256' }, { internalType: 'uint256', name: '_reserveBp', type: 'uint256' }], name: 'updateFeeSplit', outputs: [], stateMutability: 'nonpayable', type: 'function' },
] as const;

export const agentWalletAbi = [
  { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
  { inputs: [], name: 'EnforcedPause', type: 'error' },
  { inputs: [], name: 'ExpectedPause', type: 'error' },
  { inputs: [{ internalType: 'address', name: 'owner', type: 'address' }], name: 'OwnableInvalidOwner', type: 'error' },
  { inputs: [{ internalType: 'address', name: 'account', type: 'address' }], name: 'OwnableUnauthorizedAccount', type: 'error' },
  { inputs: [], name: 'ReentrancyGuardReentrantCall', type: 'error' },
  { anonymous: false, inputs: [{ indexed: true, internalType: 'address', name: 'token', type: 'address' }, { indexed: false, internalType: 'uint256', name: 'cap', type: 'uint256' }], name: 'DailyCapUpdated', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, internalType: 'address', name: 'token', type: 'address' }, { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }, { indexed: true, internalType: 'address', name: 'to', type: 'address' }], name: 'EmergencyWithdraw', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, internalType: 'address', name: 'facilitator', type: 'address' }], name: 'FacilitatorUpdated', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, internalType: 'address', name: 'previousOwner', type: 'address' }, { indexed: true, internalType: 'address', name: 'newOwner', type: 'address' }], name: 'OwnershipTransferred', type: 'event' },
  { anonymous: false, inputs: [{ indexed: false, internalType: 'address', name: 'account', type: 'address' }], name: 'Paused', type: 'event' },
  { anonymous: false, inputs: [{ indexed: false, internalType: 'address', name: 'account', type: 'address' }], name: 'Unpaused', type: 'event' },
  { anonymous: false, inputs: [{ indexed: true, internalType: 'address', name: 'service', type: 'address' }, { indexed: true, internalType: 'address', name: 'token', type: 'address' }, { indexed: false, internalType: 'uint256', name: 'amount', type: 'uint256' }, { indexed: false, internalType: 'uint256', name: 'threadId', type: 'uint256' }], name: 'X402PaymentMade', type: 'event' },
  { inputs: [{ internalType: 'address', name: 'token', type: 'address' }, { internalType: 'uint256', name: 'amount', type: 'uint256' }], name: 'approveFacilitator', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'currentDay', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: '', type: 'address' }], name: 'dailySpendCap', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'token', type: 'address' }, { internalType: 'uint256', name: 'amount', type: 'uint256' }, { internalType: 'address', name: 'to', type: 'address' }], name: 'emergencyWithdraw', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'service', type: 'address' }, { internalType: 'address', name: 'token', type: 'address' }, { internalType: 'uint256', name: 'amount', type: 'uint256' }, { internalType: 'uint256', name: 'threadId', type: 'uint256' }], name: 'executeX402Call', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'owner', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'pause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'paused', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'renounceOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'token', type: 'address' }, { internalType: 'uint256', name: 'cap', type: 'uint256' }], name: 'setDailySpendCap', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'facilitator', type: 'address' }], name: 'setFacilitator', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: '', type: 'uint256' }, { internalType: 'address', name: '', type: 'address' }], name: 'spentOnDay', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'newOwner', type: 'address' }], name: 'transferOwnership', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'unpause', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [], name: 'x402Facilitator', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
] as const;

export interface ContractAddresses {
  ShipPostPayment: Address;
  AgentWallet: Address;
}

export const CONTRACTS: Record<number, ContractAddresses> = {
  [celoSepolia.id]: {
    ShipPostPayment: (process.env.NEXT_PUBLIC_PAYMENT_CONTRACT_TESTNET ?? '0x277e140933d600cafcad38e2f1018e4fbd5476b2') as Address,
    AgentWallet: (process.env.NEXT_PUBLIC_AGENT_WALLET_TESTNET ?? '0x7538627c5eef2193fa4960f03157f482eca333be') as Address,
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
