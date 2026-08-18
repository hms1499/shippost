import { fallback, http, type Transport } from 'viem';
import { base, baseSepolia, celo } from 'viem/chains';
import { celoSepolia } from './chains';

// Official public endpoints rate-limit under a few wallet reads + a pay
// simulation (mainnet.base.org returns "over rate limit"; forno drops txs).
// Env override first; then other public RPCs; official last.

function envUrl(...keys: string[]): string[] {
  const out: string[] = [];
  for (const key of keys) {
    const v = process.env[key]?.trim();
    if (v) out.push(v);
  }
  return out;
}

function dedupe(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

export function rpcUrlsForChain(chainId: number): string[] {
  if (chainId === base.id) {
    return dedupe([
      ...envUrl('NEXT_PUBLIC_BASE_RPC_URL', 'BASE_RPC_URL'),
      'https://base-rpc.publicnode.com',
      'https://base.llamarpc.com',
      'https://base.drpc.org',
      'https://mainnet.base.org',
    ]);
  }
  if (chainId === baseSepolia.id) {
    return dedupe([
      ...envUrl('NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL', 'BASE_SEPOLIA_RPC_URL'),
      'https://sepolia.base.org',
    ]);
  }
  if (chainId === celo.id) {
    return dedupe([
      ...envUrl('NEXT_PUBLIC_CELO_RPC_URL', 'CELO_RPC_URL'),
      'https://celo-rpc.publicnode.com',
      'https://forno.celo.org',
    ]);
  }
  if (chainId === celoSepolia.id) {
    return dedupe([
      ...envUrl('NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL', 'CELO_SEPOLIA_RPC_URL'),
      'https://forno.celo-sepolia.celo-testnet.org',
    ]);
  }
  return [];
}

export function rpcTransport(chainId: number): Transport {
  const urls = rpcUrlsForChain(chainId);
  if (urls.length === 0) return http();
  if (urls.length === 1) return http(urls[0]);
  return fallback(urls.map((url) => http(url)));
}
