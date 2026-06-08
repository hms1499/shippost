import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, IM_Fell_DW_Pica, EB_Garamond } from 'next/font/google';
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

// EB Garamond — a legible, modern old-style serif in the same family as the
// display tier. The reading workhorse: body copy, labels, buttons, inputs.
// Replaces JetBrains Mono as the body face (mono is for code, not prose).
const serif = EB_Garamond({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ShipPost — pay-per-thread, written in ink',
  description: 'A Renaissance for posting. Pay $0.05, agent crafts your thread.',
  other: {
    'talentapp:project_verification': 'a716144f6408810e3737c83cfc3fd4e663c78686f3bc89e2945c4bd0346a196c4e46cc35371bf8137e929a2a73f5e6024aab7c9bf90ec93a4d34b052ddf144a8',
  },
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
    <html lang="en" className={`${mono.variable} ${display.variable} ${serif.variable}`}>
      <body>
        <ThemeApplicator />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
