'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { RuleDivider } from '@/components/terminal/RuleDivider';

/**
 * Route-level error boundary. Without one, a single throw anywhere in the tree
 * — and this app fetches two public endpoints and boots a wallet connector on
 * mount — replaces the whole product with Next's unstyled crash screen.
 *
 * The first thing someone mid-flow needs to know is whether their money is
 * gone, so that is the first thing this says.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surfaces in the browser console and in Vercel's client logs; the digest
    // is the only handle on the server-side stack.
    console.error('[coinop] unhandled error', error);
  }, [error]);

  return (
    <main id="main-content" className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 py-10">
      <section className="w-full max-w-md flex flex-col gap-4">
        <p className="heading-sub text-[10px] text-destructive">Error</p>
        <h1 className="font-mono font-bold text-2xl tracking-tight">This screen stopped.</h1>
        <RuleDivider />
        <p className="text-sm font-sans text-muted-foreground leading-snug">
          A thread you already paid for is not lost. Payment happens on chain before any
          writing starts, and reopening the app picks that run back up.
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={reset}>Reload the screen</Button>
          <a
            href="/"
            className="font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors"
          >
            back to the composer
          </a>
        </div>
        {error.digest && (
          <p className="font-mono text-[11px] text-muted-foreground">
            reference {error.digest}
          </p>
        )}
      </section>
    </main>
  );
}
