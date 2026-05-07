import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, IM_Fell_DW_Pica } from 'next/font/google';
import { Providers } from './providers';
import { ThemeApplicator } from '@/components/ThemeApplicator';
import './globals.css';

const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-mono',
  display: 'swap',
});

// IM Fell DW Pica — type cut by John Fell c. 1690, period-correct codex
// hand-press feel with deliberate ink irregularity. Reserved for display
// surfaces (hero, section titles, illuminated initials, drop cap).
const display = IM_Fell_DW_Pica({
  subsets: ['latin'],
  weight: ['400'],
  style: ['normal', 'italic'],
  variable: '--font-display',
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
    <html lang="en" className={`${mono.variable} ${display.variable}`}>
      <body>
        <ThemeApplicator />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
