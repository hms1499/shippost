'use client';

import { useChainId, useReadContract } from 'wagmi';
import type { Address } from 'viem';
import { getContracts, shipPostPaymentAbi } from './contracts';
import type { TokenBalance } from './useBalances';

/**
 * The payment contract on a chain, or undefined.
 *
 * getContracts throws on an unsupported chain — correct for server code, wrong
 * inside a render, where the wrong-network screen is about to be shown and must
 * not be pre-empted by a thrown error. Mirrors tokenListFor in useBalances.
 */
export function paymentAddressFor(chainId: number | undefined): Address | undefined {
  if (!chainId) return undefined;
  try {
    return getContracts(chainId).ShipPostPayment || undefined;
  } catch {
    return undefined;
  }
}

/**
 * The authoritative thread price, shaped for render.
 *
 * The reactive twin of readThreadPrice (lib/threadPrice.ts) — the same
 * requiredAmount(token) read, so a button gated on this number and the payment
 * that follows cannot disagree. Compare balances against THIS, never against
 * THREAD_PRICE_USD: the on-chain price is settable, so the local constant is
 * display-only and a stale one would block wallets that can afford the real
 * price.
 *
 * Returns null while unknown. Callers must treat null as "do not gate", not as
 * "free" — see payability().
 */
export function useThreadPrice(token: TokenBalance | null): bigint | null {
  const chainId = useChainId();
  const address = paymentAddressFor(chainId);

  const { data } = useReadContract({
    address,
    abi: shipPostPaymentAbi,
    functionName: 'requiredAmount',
    args: token ? [token.address] : undefined,
    chainId: chainId as 11142220 | 8453 | 84532 | 42220 | undefined,
    query: { enabled: Boolean(address && token) },
  });

  const price = data as bigint | undefined;
  // setPrice rejects zero, so a zero here means the wrong address or a chain
  // with no deployment. readThreadPrice refuses to pay against it; the UI must
  // not gate against it either.
  return price !== undefined && price > 0n ? price : null;
}
