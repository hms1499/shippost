import { celo, base, baseSepolia } from 'wagmi/chains';
import { celoSepolia } from './chains';

// Which chains this deployment accepts, and which one it prefers. Split out of
// the old lib/targetChain.ts, which assumed exactly one chain — a name that
// stops being true the moment Base and Celo both run.
const KNOWN_IDS = [base.id, celo.id, baseSepolia.id, celoSepolia.id] as const;

function parseIds(raw: string | undefined): number[] {
  if (!raw?.trim()) return [];
  return raw
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && (KNOWN_IDS as readonly number[]).includes(n));
}

const configured = parseIds(process.env.NEXT_PUBLIC_SUPPORTED_CHAIN_IDS);

export const SUPPORTED_CHAIN_IDS: readonly number[] =
  configured.length > 0 ? configured : [base.id, celo.id];

const rawDefault = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN_ID);

// A default outside the allowlist would strand every user on a chain we reject,
// so the allowlist wins over the env default.
export const DEFAULT_CHAIN_ID: number = SUPPORTED_CHAIN_IDS.includes(rawDefault)
  ? rawDefault
  : (SUPPORTED_CHAIN_IDS[0] as number);

export function isSupportedChain(chainId: number | undefined): boolean {
  if (chainId === undefined || !Number.isInteger(chainId)) return false;
  return SUPPORTED_CHAIN_IDS.includes(chainId);
}

export function isTestnet(chainId: number): boolean {
  return chainId === baseSepolia.id || chainId === celoSepolia.id;
}

export function chainLabel(chainId: number): string {
  switch (chainId) {
    case base.id:
      return 'Base';
    case celo.id:
      return 'Celo';
    case baseSepolia.id:
      return 'Base Sepolia (testnet)';
    case celoSepolia.id:
      return 'Celo Sepolia (testnet)';
    default:
      return `chain ${chainId}`;
  }
}

// MiniPay runs only on Celo and exposes NO wallet_switchEthereumChain — its
// chain comes from the wallet's own "Use Testnet" toggle, never from the dapp.
// Kept from lib/targetChain.ts so the MiniPay guidance in the UI survives.
export function isMiniPayChain(chainId: number): boolean {
  return chainId === celo.id || chainId === celoSepolia.id;
}

// Soft Model-1 settles (Serper, FactCheck) call AgentWallet.executeX402Call on
// the payment chain. That is the Celo MiniApp demo; on Base it is just ETH
// burned for a simulated sink. Groq already settles via Model 2 (x402). Skip
// the soft on-chain hop on Base so the orchestrator EOA can run near-zero ETH.
export function settlesSoftStepsOnChain(chainId: number): boolean {
  return chainId !== base.id && chainId !== baseSepolia.id;
}
