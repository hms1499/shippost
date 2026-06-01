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
      // Match the mobile status-bar tint to the slate theme. Dark is forced by
      // class here (not prefers-color-scheme), so a media-query theme-color
      // wouldn't track it — update the meta tag directly.
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', '#0f1729');
    }
  }, []);
  return null;
}
