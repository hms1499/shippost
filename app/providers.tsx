'use client';

import { useEffect, useState } from 'react';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme, lightTheme } from '@rainbow-me/rainbowkit';
import { wagmiConfig } from '@/lib/wagmi';
import { PAPER_CLASS } from '@/lib/theme';
import '@rainbow-me/rainbowkit/styles.css';

// RainbowKit renders its own surface, so it has to be told the theme; it does
// not inherit our tokens. Until now it was pinned to lightTheme with the sepia
// accents of the Da Vinci parchment identity deleted in 32aedf2, so the connect
// modal came up white over the phosphor terminal.
const RK = {
  terminal: darkTheme({
    accentColor: '#59F87D',
    accentColorForeground: '#06180C',
    borderRadius: 'medium',
    fontStack: 'system',
    overlayBlur: 'small',
  }),
  paper: lightTheme({
    accentColor: '#0F7A33',
    accentColorForeground: '#FBFAF4',
    borderRadius: 'medium',
    fontStack: 'system',
    overlayBlur: 'small',
  }),
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  // The toggle mutates the class on <html> directly, so observe that rather
  // than adding a second source of truth for the current theme.
  const [paper, setPaper] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setPaper(el.classList.contains(PAPER_CLASS));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          theme={paper ? RK.paper : RK.terminal}
          appInfo={{ appName: 'CoinOp' }}
          modalSize="compact"
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
