'use client';

import { useAccount, useChainId, useReadContracts } from 'wagmi';
import { erc20Abi, type Address } from 'viem';
import { getTokens, type TokenConfig, type TokenSymbol } from './tokens';

export interface TokenBalance {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
  balance: bigint;
  displayName: string;
}

/**
 * The tokens payable on a chain, or none.
 *
 * getTokens throws on an unsupported chain, which is the right shape for
 * server code but wrong inside a render: the wrong-network screen is about to
 * be shown and must not be pre-empted by a thrown error.
 */
export function tokenListFor(chainId: number | undefined): TokenConfig[] {
  if (!chainId) return [];
  try {
    return Object.values(getTokens(chainId));
  } catch {
    return [];
  }
}

export function useBalances(options?: { chainId?: number; enabled?: boolean }) {
  const { address } = useAccount();
  const connectedChainId = useChainId();
  // Default to the connected chain. An explicit chainId reads a chain the
  // wallet is NOT on — wagmi routes it through that chain's transport, so no
  // switch is involved. Used by the picker to show both chains at once.
  const chainId = options?.chainId ?? connectedChainId;
  const tokenList = tokenListFor(chainId);

  const enabled =
    (options?.enabled ?? true) && Boolean(address) && tokenList.length > 0;

  const { data, isLoading, isError, refetch } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: t.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [address ?? '0x0000000000000000000000000000000000000000'],
      chainId: chainId as 11142220 | 8453 | 84532 | 42220 | undefined,
    })),
    query: { enabled },
  });

  const balances: TokenBalance[] = tokenList.map((t, i) => ({
    ...t,
    balance: (data?.[i]?.result as bigint | undefined) ?? 0n,
  }));

  // A disabled or in-flight query must not report loaded: data is undefined and
  // consumers zero-fill balances, which reads as "you are broke" and triggers
  // user action. A settled but failed query must not report loading: that creates
  // an infinite spinner with no exit. Only report loading when actually fetching
  // and not in an error state.
  const pending = enabled && !isError && (isLoading || data === undefined);

  return { balances, isLoading: pending, isError, refetch };
}
