import { getContracts, shipPostPaymentAbi } from './contracts';
import type { TokenConfig } from './tokens';

// Only the one call this needs, rather than viem's full PublicClient. The repo
// resolves several viem copies, so a structural PublicClient from wagmi's copy
// is not assignable to one imported here — and narrowing to the reader keeps
// the function trivially testable besides.
interface ContractReader {
  readContract: (args: {
    address: `0x${string}`;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<unknown>;
}

/**
 * The authoritative thread price, in this token's base units.
 *
 * The contract price is settable (ShipPostPayment.setPrice), so anything
 * computed client-side from THREAD_PRICE_USD can be stale. The approve amount,
 * the maxAmount ceiling and the price shown to the user all derive from this
 * single read, so they cannot disagree with each other or with the chain.
 *
 * Deliberately does NOT fall back to the local constant on failure: paying a
 * guessed price is worse than not paying. If the price cannot be read, the
 * caller should surface the error rather than sign something unverified.
 */
export async function readThreadPrice(params: {
  publicClient: ContractReader;
  chainId: number;
  token: TokenConfig;
}): Promise<bigint> {
  const contracts = getContracts(params.chainId);
  const price = (await params.publicClient.readContract({
    address: contracts.ShipPostPayment,
    abi: shipPostPaymentAbi,
    functionName: 'requiredAmount',
    args: [params.token.address],
  })) as bigint;

  // setPrice rejects zero, so a zero here means we read the wrong address (or a
  // chain with no contract deployed). Approving against it would be signing for
  // an unknown amount.
  if (price <= 0n) {
    throw new Error(
      `thread price read as ${price} on chain ${params.chainId} — refusing to pay an unverified price`,
    );
  }
  return price;
}
