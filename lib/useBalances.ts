'use client';

import { useAccount, useChainId, useReadContracts } from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import { getTokens, type TokenSymbol } from './tokens';

export interface TokenBalance {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
  balance: bigint;
  displayName: string;
}

export function useBalances() {
  const { address } = useAccount();
  const chainId = useChainId();

  let tokens = null;
  try {
    tokens = chainId ? getTokens(chainId) : null;
  } catch {
    tokens = null;
  }
  const tokenList = tokens ? Object.values(tokens) : [];

  const { data, isLoading, refetch } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [address ?? '0x0000000000000000000000000000000000000000'],
    })),
    query: { enabled: Boolean(address && tokens) },
  });

  const balances: TokenBalance[] = tokenList.map((t, i) => ({
    ...t,
    balance: (data?.[i]?.result as bigint | undefined) ?? 0n,
  }));

  return { balances, isLoading, refetch };
}
