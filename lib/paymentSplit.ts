// The fee split, in the same arithmetic the contract uses.
//
// `ShipPostPayment.payForThread` splits in INTEGER token units:
//
//     agentShare    = (amount * agentBp)    / 10000
//     treasuryShare = (amount * treasuryBp) / 10000
//     reserve       = amount - agentShare - treasuryShare   // dust rounds in
//
// The receipt used to recompute this as `Number(paid) * 0.5` in floating point.
// At $0.10 the two agree, so nothing looked wrong; at any amount that does not
// divide evenly they diverge, and the reserve is where the difference lands.
// A receipt is presented as a record of what happened on chain, with tx links
// beside it — when it disagrees with the chain, the document that looks most
// authoritative is the wrong one.

/** Basis points, mirroring the contract's defaults. */
export const AGENT_BP = 5000n;
export const TREASURY_BP = 4000n;
export const BP_DENOMINATOR = 10_000n;

export interface PaymentSplit {
  agent: bigint;
  treasury: bigint;
  /** Retained in the contract as the refund pool. Absorbs the rounding dust. */
  reserve: bigint;
}

/**
 * Split a raw token amount the way the contract did.
 *
 * NOTE: the contract's bps are owner-settable (`updateFeeSplit`), and this
 * mirrors the defaults rather than reading them back per thread. If they are
 * ever changed, a receipt printed for an older payment would describe the new
 * split — the same class of drift as reading a price at head. They have never
 * been changed; if that stops being true, read them at the payment's block.
 */
export function splitPaidAmount(amountRaw: bigint): PaymentSplit {
  const agent = (amountRaw * AGENT_BP) / BP_DENOMINATOR;
  const treasury = (amountRaw * TREASURY_BP) / BP_DENOMINATOR;
  // Not (amount * reserveBp) / 10000: the contract keeps the remainder, so the
  // three shares always add back to exactly what the user paid.
  return { agent, treasury, reserve: amountRaw - agent - treasury };
}
