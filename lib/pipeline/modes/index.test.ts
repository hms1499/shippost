// lib/pipeline/modes/index.test.ts
import { describe, it, expect, vi } from 'vitest';

// Keep the registry test pure: importing the descriptors must not drag in the
// real paid pipeline (groq-sdk, env, etc.). We only exercise the id→def map.
vi.mock('@/lib/pipeline/runModeA', () => ({ runModeA: vi.fn(), MODE_A_TOTAL_COST_USD: '0.050' }));
vi.mock('@/lib/pipeline/runModeB', () => ({ runModeB: vi.fn() }));

const { getMode, MODES } = await import('./index');

describe('mode registry', () => {
  it('maps id 0 to the educational mode', () => {
    expect(getMode(0)?.id).toBe(0);
    expect(getMode(0)?.key).toBe('educational');
  });

  it('maps id 1 to the hot-take mode', () => {
    expect(getMode(1)?.key).toBe('hotTake');
  });

  it('returns null for an unknown mode id', () => {
    expect(getMode(7)).toBeNull();
  });

  it('returns null for undefined/null', () => {
    expect(getMode(undefined)).toBeNull();
    expect(getMode(null)).toBeNull();
  });

  it('every registered mode key matches its map id', () => {
    for (const [id, mode] of Object.entries(MODES)) {
      expect(mode.id).toBe(Number(id));
    }
  });
});
