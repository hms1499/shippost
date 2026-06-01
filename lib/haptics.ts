export type HapticKind = 'tap' | 'success' | 'error' | 'tick';

// Vibration patterns in ms. Single number = one buzz; array = buzz/pause/buzz.
const PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  tick: 8,
  success: [12, 40, 18],
  error: [30, 40, 30],
};

// Fire a short haptic at a meaningful interaction moment. No-ops where the
// Vibration API is absent (notably iOS Safari/webview) and when the user has
// asked for reduced motion. Safe to call during SSR.
export function haptic(kind: HapticKind): void {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
  navigator.vibrate(PATTERNS[kind]);
}
