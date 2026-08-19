'use client';

import './globals.css';

/**
 * Last resort: this replaces the root layout itself, so it must ship its own
 * <html>/<body> and cannot lean on anything the layout provides. Deliberately
 * plain — whatever broke may well be the thing that renders everything else.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <main className="min-h-screen flex flex-col items-center justify-center gap-5 px-6 text-center">
          <p className="heading-sub text-[10px] text-destructive">Error</p>
          <h1 className="font-mono font-bold text-2xl tracking-tight">CoinOp failed to load.</h1>
          <p className="text-sm font-sans text-muted-foreground max-w-sm leading-snug">
            Nothing was charged by this screen. Any thread already paid for is recorded on
            chain and waiting when the app loads again.
          </p>
          <button
            type="button"
            onClick={reset}
            className="h-11 px-4 rounded-md bg-primary text-primary-foreground font-mono font-bold uppercase tracking-wide text-sm"
          >
            Try again
          </button>
          {error.digest && (
            <p className="font-mono text-[11px] text-muted-foreground">reference {error.digest}</p>
          )}
        </main>
      </body>
    </html>
  );
}
