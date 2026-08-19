import type { TokenBalance } from './useBalances';

export type PayBlockReason = 'no-token' | 'empty' | 'short';
export type Payability = { canPay: true } | { canPay: false; reason: PayBlockReason };

const ALLOW: Payability = { canPay: true };

/**
 * Can this wallet actually pay for a thread right now?
 *
 * Used to disable the submit button before the user invests any effort, and as
 * the backstop in HomeClient.unlock(). Biased to ALLOW, for the same reason
 * /api/preflight fails open: a wrong "no" here is a user who could have paid
 * and was turned away, which is worse than a payment that fails visibly in the
 * wallet.
 *
 * `price` must come from the chain (ShipPostPayment.requiredAmount, the same
 * read lib/threadPrice.ts uses to pay). Never pass a value derived from
 * THREAD_PRICE_USD: the on-chain price is settable, so a stale local constant
 * would block wallets that can in fact afford the real price.
 */
export function payability(args: {
  token: TokenBalance | null;
  /** On-chain price in the token's base units, or null if it is not known yet. */
  price: bigint | null;
  balancesLoading: boolean;
  balancesError: boolean;
}): Payability {
  // No balance data is not the same as a balance of zero. useBalances returns
  // an empty list on error and zero-fills before the read lands, so blocking on
  // either would tell a funded user they are broke.
  if (args.balancesLoading || args.balancesError) return ALLOW;

  if (!args.token) return { canPay: false, reason: 'no-token' };

  // Zero cannot cover any price, so this needs no price read — which matters,
  // because the price read is the part that can be missing.
  if (args.token.balance === 0n) return { canPay: false, reason: 'empty' };

  // Refusing over a price we could not verify would be guessing in the
  // blocking direction. Let the wallet be the judge instead.
  if (args.price === null) return ALLOW;

  return args.token.balance < args.price ? { canPay: false, reason: 'short' } : ALLOW;
}
