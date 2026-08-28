import type { Metadata, Viewport } from 'next';
import { JetBrains_Mono, Inter } from 'next/font/google';
import { Providers } from './providers';
import { shareAppUrl } from '@/lib/shareText';
import { THEME_STORAGE_KEY, PAPER_CLASS, THEME_COLOR } from '@/lib/theme';
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

const TITLE = 'CoinOp — coin-operated AI agent';
const DESCRIPTION =
  'Drop $0.10 in. An on-chain agent pays AI services per call (x402) and hands you a ready-to-post X thread.';

export const metadata: Metadata = {
  // Every share link this app builds points back here (lib/shareText.ts), and
  // without a card those links land in someone's feed as a bare t.co stub.
  // metadataBase also resolves the generated opengraph-image to an absolute
  // URL, which every scraper requires.
  metadataBase: new URL(shareAppUrl()),
  title: TITLE,
  description: DESCRIPTION,
  // Both / and /app resolve to the same composer, and share links land on the
  // root — so they must not be treated as separate ranking sites. Next 14 does
  // not emit a canonical link by default; declaring the root here stops Google
  // from treating /app as an independent, thin-page URL.
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: 'CoinOp',
    title: TITLE,
    description: DESCRIPTION,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
  other: {
    'talentapp:project_verification': 'a716144f6408810e3737c83cfc3fd4e663c78686f3bc89e2945c4bd0346a196c4e46cc35371bf8137e929a2a73f5e6024aab7c9bf90ec93a4d34b052ddf144a8',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  // No themeColor here on purpose: it is per-user now, so the tag is written
  // by the pre-paint script below and updated by the toggle. A static value
  // would paint the status bar in whichever theme the user is not using.
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${mono.variable} ${inter.variable}`}>
      <head>
        {/*
          Resolve the theme BEFORE the first paint. The previous attempt at this
          (components/ThemeApplicator.tsx, deleted in 32aedf2) ran in useEffect
          and its own docstring conceded "there is a brief flash" — every user
          saw the wrong theme and then a swap. A blocking script in <head> is
          the only place that cannot happen.

          It duplicates the storage key and class name from lib/theme.ts because
          it runs before any module loads; lib/theme.test.ts pins both values so
          the copies cannot drift. Wrapped in try/catch: Safari private mode
          throws on localStorage access, and a throw here would blank the page.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem(${JSON.stringify(
              THEME_STORAGE_KEY,
            )})==='paper';if(p)document.documentElement.classList.add(${JSON.stringify(
              PAPER_CLASS,
            )});var m=document.createElement('meta');m.name='theme-color';m.content=p?${JSON.stringify(
              THEME_COLOR.paper,
            )}:${JSON.stringify(
              THEME_COLOR.terminal,
            )};document.head.appendChild(m);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'CoinOp',
              description: DESCRIPTION,
              url: shareAppUrl(),
            }),
          }}
        />
        {/* Keyboard/screen-reader users land here on first Tab so they can jump
            straight past the header/hero/stats to the content, instead of
            tabbing through the whole machine. Hidden until focused. */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:font-mono focus:text-xs focus:text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Skip to content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
