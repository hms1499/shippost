import type { Metadata } from 'next';
import dynamic from 'next/dynamic';
import './globals.css';

const Providers = dynamic(
  () => import('./providers').then((m) => ({ default: m.Providers })),
  { ssr: false },
);

export const metadata: Metadata = {
  title: 'ShipPost',
  description: 'Pay-per-post AI thread writer for crypto builders',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
