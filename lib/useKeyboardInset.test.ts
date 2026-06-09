import { describe, it, expect } from 'vitest';
import { computeKeyboardInset, KEYBOARD_MIN_INSET } from './useKeyboardInset';

describe('computeKeyboardInset', () => {
  it('returns the overlap when the keyboard shrinks the visual viewport', () => {
    // Layout viewport 800, keyboard takes 300 → visual viewport 500.
    expect(
      computeKeyboardInset({ innerHeight: 800, viewportHeight: 500, offsetTop: 0 }),
    ).toBe(300);
  });

  it('accounts for visualViewport.offsetTop (page scrolled under the keyboard)', () => {
    expect(
      computeKeyboardInset({ innerHeight: 800, viewportHeight: 500, offsetTop: 40 }),
    ).toBe(260);
  });

  it('returns 0 when no keyboard is open (viewport equals layout)', () => {
    expect(
      computeKeyboardInset({ innerHeight: 800, viewportHeight: 800, offsetTop: 0 }),
    ).toBe(0);
  });

  it('ignores small insets below the threshold (URL bar / chrome jitter)', () => {
    const small = KEYBOARD_MIN_INSET - 1;
    expect(
      computeKeyboardInset({ innerHeight: 800, viewportHeight: 800 - small, offsetTop: 0 }),
    ).toBe(0);
  });

  it('clamps negative insets to 0', () => {
    expect(
      computeKeyboardInset({ innerHeight: 500, viewportHeight: 800, offsetTop: 0 }),
    ).toBe(0);
  });

  it('rounds sub-pixel viewport heights', () => {
    expect(
      computeKeyboardInset({ innerHeight: 800, viewportHeight: 499.6, offsetTop: 0 }),
    ).toBe(300);
  });
});
