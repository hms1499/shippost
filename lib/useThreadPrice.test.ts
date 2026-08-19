import { describe, it, expect } from 'vitest';
import { base, celo } from 'wagmi/chains';
import { paymentAddressFor } from './useThreadPrice';
import { getContracts } from './contracts';

// getContracts throws on an unsupported chain, which is right for server code
// and wrong inside a render — the wrong-network screen is about to show and
// must not be pre-empted by a thrown error. Same hazard tokenListFor guards.
describe('paymentAddressFor', () => {
  it('returns the payment contract for a supported chain', () => {
    expect(paymentAddressFor(celo.id)).toBe(getContracts(celo.id).ShipPostPayment);
    expect(paymentAddressFor(base.id)).toBe(getContracts(base.id).ShipPostPayment);
  });

  it('returns undefined for an unsupported chain instead of throwing', () => {
    expect(paymentAddressFor(1)).toBeUndefined();
  });

  it('returns undefined when the chain is not known yet', () => {
    expect(paymentAddressFor(undefined)).toBeUndefined();
  });
});
