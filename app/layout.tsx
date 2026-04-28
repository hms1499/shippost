import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
