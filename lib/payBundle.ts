import { erc20Abi, type Address } from 'viem';
import { shipPostPaymentAbi } from './contracts';
import type { TokenConfig } from './tokens';

export interface PayCall {
  to: Address;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

/**
 * The calls for one paid thread, as an EIP-5792 batch.
 *
 * Batching is not just a gas convenience: sending approve and payForThread as
 * two separate transactions leaves a gap where the approve can revert, land
 * short, or be rewritten by the wallet — the gap behind both the USDT
 * approve-receipt bug and the first-payment allowance-0 bug. In one bundle
 * there is no intermediate state to fail into.
 *
 * `price` must come from readThreadPrice, and is passed straight through as
 * maxAmount: the ceiling is the user's consent, so it is exactly the number
 * they were shown, never padded. The approve is batched over many threads;
 * the ceiling is not, so a batched approve never raises what one pay can take.
 *
 * payForThread is always last — the caller reads the final receipt as the pay
 * transaction, which is the call that emits ThreadRequested.
 */
export function buildPayCalls(params: {
  token: TokenConfig;
  paymentAddr: Address;
  price: bigint;
  mode: number;
  needsApprove: boolean;
  approveBatch: bigint;
}): PayCall[] {
  const calls: PayCall[] = [];

  if (params.needsApprove) {
    calls.push({
      to: params.token.address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [params.paymentAddr, params.price * params.approveBatch],
    });
  }

  calls.push({
    to: params.paymentAddr,
    abi: shipPostPaymentAbi,
    functionName: 'payForThread',
    args: [params.token.address, params.mode, params.price],
  });

  return calls;
}
