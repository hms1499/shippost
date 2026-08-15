import { describe, it, expect } from 'vitest';
import { gasNote } from './useGasSponsorship';

describe('gasNote', () => {
  it('promises no gas only when sponsorship was confirmed', () => {
    expect(gasNote('sponsored')).toBe('no gas');
  });

  it('says the user pays when the wallet answered and had no paymaster', () => {
    expect(gasNote('self')).toBe('you pay gas');
  });

  it('says nothing at all when the wallet never answered', () => {
    // Guessing "no gas" for a MiniPay user who will pay gas is the fastest way
    // to lose the trust this line exists to build.
    expect(gasNote('unknown')).toBeNull();
  });
});
