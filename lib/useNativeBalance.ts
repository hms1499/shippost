'use client';

import { useAccount, useBalance, useChainId } from 'wagmi';
import { getChain } from './chains';

export interface NativeBalance {
  symbol: string;
  decimals: number;
  value: bigint;
}

function fallbackSymbol(chainId: number | undefined): string {
  if (!chainId) return 'ETH';
  try {
    return getChain(chainId).nativeCurrency.symbol;
  } catch {
    return 'ETH';
  }
}

/**
 * Native gas token of a chain (ETH on Base, CELO on Celo). Not a payable
 * thread token — do not fold this into useBalances / TokenSelector.
 */
export function useNativeBalance(options?: { chainId?: number; enabled?: boolean }) {
  const { address } = useAccount();
  const connectedChainId = useChainId();
  const chainId = options?.chainId ?? connectedChainId;
  const enabled = (options?.enabled ?? true) && Boolean(address) && Boolean(chainId);

  const { data, isLoading, isError, refetch } = useBalance({
    address,
    chainId: chainId as 11142220 | 8453 | 84532 | 42220 | undefined,
    query: { enabled },
  });

  const native: NativeBalance = {
    symbol: data?.symbol ?? fallbackSymbol(chainId),
    decimals: data?.decimals ?? 18,
    value: data?.value ?? 0n,
  };

  const pending = enabled && !isError && (isLoading || data === undefined);
  return { native, isLoading: pending, isError, refetch };
}
