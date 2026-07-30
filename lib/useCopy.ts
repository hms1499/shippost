'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { haptic } from '@/lib/haptics';

export type CopyState = 'idle' | 'copied' | 'failed';

/**
 * SSR-safe clipboard write that reports whether it actually landed. The MiniPay
 * webview can refuse `writeText` (permission, non-secure context), and a silent
 * no-op is the worst outcome here: the user taps copy, pastes nothing into X,
 * and blames the thread. Callers surface `failed` as visible copy instead.
 */
export async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy-to-clipboard with a short-lived "copied" confirmation.
 *
 * `copied` self-clears after `resetMs` so the button returns to its label;
 * `failed` deliberately does NOT — a blocked clipboard needs manual fallback
 * instructions to stay on screen until the next attempt.
 */
export function useCopy(resetMs = 1500) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      if (timer.current) clearTimeout(timer.current);
      const ok = await writeClipboard(text);
      if (ok) haptic('tick');
      setState(ok ? 'copied' : 'failed');
      if (ok) timer.current = setTimeout(() => setState('idle'), resetMs);
      return ok;
    },
    [resetMs],
  );

  return { state, copied: state === 'copied', failed: state === 'failed', copy };
}
