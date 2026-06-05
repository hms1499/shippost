'use client';

import { useEffect, useState } from 'react';

const QUERY = '(min-width: 1024px)';

/** SSR-safe synchronous read of the desktop breakpoint. */
export function matchesDesktop(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(QUERY).matches;
}

/**
 * Tracks whether the viewport is at the desktop breakpoint (>=1024px).
 * Returns false until mounted, matching the `mounted` flash pattern in
 * HomeClient so SSR and first paint render the mobile single column.
 */
export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isDesktop;
}
