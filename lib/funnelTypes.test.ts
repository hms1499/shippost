import { describe, it, expect } from 'vitest';
import {
  FUNNEL_STAGES,
  isFunnelStage,
  isValidMode,
  UUID_RE,
  WALLET_RE,
} from './funnelTypes';

describe('funnelTypes', () => {
  it('lists the stages in funnel order', () => {
    expect(FUNNEL_STAGES).toEqual([
      'connect',
      'mode_select',
      'submit',
      'preview',
      'pay',
      'share',
      'receipt_copied',
    ]);
  });

  it('isFunnelStage accepts known stages and rejects others', () => {
    expect(isFunnelStage('pay')).toBe(true);
    expect(isFunnelStage('checkout')).toBe(false);
    expect(isFunnelStage(42)).toBe(false);
  });

  it('isValidMode accepts 0–4 and null/undefined, rejects the rest', () => {
    expect(isValidMode(0)).toBe(true);
    expect(isValidMode(2)).toBe(true);
    expect(isValidMode(3)).toBe(true);
    expect(isValidMode(4)).toBe(true);
    expect(isValidMode(null)).toBe(true);
    expect(isValidMode(undefined)).toBe(true);
    expect(isValidMode(5)).toBe(false);
    expect(isValidMode('1')).toBe(false);
  });

  it('UUID_RE matches a v4-shaped id and rejects junk', () => {
    expect(UUID_RE.test('3f2504e0-4f89-41d3-9a0c-0305e82c3301')).toBe(true);
    expect(UUID_RE.test('not-a-uuid')).toBe(false);
  });

  it('WALLET_RE matches a 0x address and rejects junk', () => {
    expect(WALLET_RE.test('0x' + 'a'.repeat(40))).toBe(true);
    expect(WALLET_RE.test('0x123')).toBe(false);
  });
});
