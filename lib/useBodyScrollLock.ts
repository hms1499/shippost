import { useEffect } from 'react';

// Pure, SSR-safe body-scroll toggle. Setting overflow to '' on unlock reverts to
// the stylesheet default (body has no inline overflow otherwise). Stateless, so
// it's trivially testable and safe for the app's single bottom sheet.
export function setBodyScrollLocked(locked: boolean): void {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = locked ? 'hidden' : '';
}

// Lock background scroll while `locked` is true; always release on unmount.
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    setBodyScrollLocked(locked);
    return () => setBodyScrollLocked(false);
  }, [locked]);
}
