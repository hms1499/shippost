import { describe, it, expect } from 'vitest';
import { parseEther } from 'viem';
import { formatNativeAmount } from './formatNative';

describe('formatNativeAmount', () => {
  it('renders zero as 0', () => {
    expect(formatNativeAmount(0n)).toBe('0');
  });

  it('uses 2 decimals at or above 1', () => {
    expect(formatNativeAmount(parseEther('1.234'))).toBe('1.23');
  });

  it('uses 4 decimals between 0.01 and 1 so gas is visible', () => {
    expect(formatNativeAmount(parseEther('0.0421'))).toBe('0.0421');
  });

  it('keeps sub-cent amounts instead of rounding to 0.00', () => {
    expect(formatNativeAmount(parseEther('0.000192'))).toBe('0.000192');
  });
});
