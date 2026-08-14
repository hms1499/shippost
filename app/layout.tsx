import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Inter } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-mono',
  display: 'swap',
});

// Inter (`font-sans`) is for writing addressed to humans: AI-generated thread
// content and explanatory prose (error bodies, help notes, descriptions).
// Chrome, labels, status lines, and data stay machine (mono, the default).
const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'CoinOp — coin-operated AI agent',
  description: 'Drop $0.10 in. An on-chain agent pays AI services per call (x402) and hands you a ready-to-post X thread.',
  other: {
    'talentapp:project_verification': 'a716144f6408810e3737c83cfc3fd4e663c78686f3bc89e2945c4bd0346a196c4e46cc35371bf8137e929a2a73f5e6024aab7c9bf90ec93a4d34b052ddf144a8',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // Single dark theme — set statically; ThemeApplicator (runtime MiniPay
  // detection) is deleted.
  themeColor: '#0A0D0A',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${mono.variable} ${inter.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
