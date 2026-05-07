'use client';

import { useEffect } from 'react';

/**
 * Toggles the `dark` class on <html> based on whether the page is rendered
 * inside the MiniPay webview. Web users keep the default light parchment
 * theme; MiniPay users get the slate dark theme matched to mobile webview
 * conventions. Detection runs on mount so SSR is unaffected — there is a
 * brief flash for MiniPay users (acceptable for an in-wallet webview).
 */
export function ThemeApplicator() {
  useEffect(() => {
    const eth = (window as unknown as { ethereum?: { isMiniPay?: boolean } })
      .ethereum;
    if (eth?.isMiniPay) {
      document.documentElement.classList.add('dark');
    }
  }, []);
  return null;
}
