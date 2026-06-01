import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { haptic } from './haptics';

const vibrate = vi.fn();

// node-env vitest has no window/navigator; stub them per test.
function setup(opts: { vibrate?: typeof vibrate; reduce: boolean }) {
  vi.stubGlobal('navigator', opts.vibrate ? { vibrate: opts.vibrate } : {});
  vi.stubGlobal('window', {
    matchMedia: vi.fn(() => ({ matches: opts.reduce })),
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('haptic', () => {
  it('vibrates with the tap pattern when supported and motion allowed', () => {
    setup({ vibrate, reduce: false });
    haptic('tap');
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it('uses array patterns for success and error', () => {
    setup({ vibrate, reduce: false });
    haptic('success');
    expect(vibrate).toHaveBeenCalledWith([12, 40, 18]);
    haptic('error');
    expect(vibrate).toHaveBeenCalledWith([30, 40, 30]);
  });

  it('no-ops when vibrate is unsupported', () => {
    setup({ reduce: false }); // navigator has no vibrate
    haptic('tap');
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('no-ops when reduced motion is set', () => {
    setup({ vibrate, reduce: true });
    haptic('error');
    expect(vibrate).not.toHaveBeenCalled();
  });
});
