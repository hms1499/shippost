import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, JetBrains_Mono } from 'next/font/google';
import { Providers } from './providers';
import { ThemeApplicator } from '@/components/ThemeApplicator';
import './globals.css';

const cormorant = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ShipPost — pay-per-thread, written in ink',
  description: 'A Renaissance for posting. Pay $0.05, agent crafts your thread.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#ede3ce',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cormorant.variable} ${mono.variable}`}>
      <body>
        <ThemeApplicator />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
