'use client';

import { useEffect, useState } from 'react';

/**
 * Minimum visual-viewport shrink (px) we treat as "the keyboard is open".
 * Hiding/showing the browser URL bar also resizes the visual viewport by a few
 * dozen px; a real on-screen keyboard is far taller. The threshold filters that
 * chrome jitter so we don't add stray padding while the user is just scrolling.
 */
export const KEYBOARD_MIN_INSET = 120;

/**
 * How many px the on-screen keyboard overlaps the layout viewport, derived from
 * the difference between the layout viewport (`innerHeight`) and the visual
 * viewport. Pure so it can be unit-tested without a real `visualViewport`.
 */
export function computeKeyboardInset(opts: {
  innerHeight: number;
  viewportHeight: number;
  offsetTop: number;
}): number {
  const overlap = opts.innerHeight - opts.viewportHeight - opts.offsetTop;
  return overlap >= KEYBOARD_MIN_INSET ? Math.round(overlap) : 0;
}

/**
 * Tracks the on-screen keyboard height in a mobile webview via the
 * VisualViewport API. CoinOp is mobile-only (MiniPay); when the keyboard
 * opens it shrinks the visual viewport, which we surface so the layout can add
 * matching bottom scroll-room and keep the bottom CTA reachable above the
 * keyboard. Returns 0 when there's no keyboard, no `visualViewport`, or on SSR.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () =>
      setInset(
        computeKeyboardInset({
          innerHeight: window.innerHeight,
          viewportHeight: vv.height,
          offsetTop: vv.offsetTop,
        }),
      );

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  return inset;
}
