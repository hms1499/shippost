import Link from 'next/link';
import { RuleDivider } from '@/components/terminal/RuleDivider';

export default function NotFound() {
  return (
    <main id="main-content" className="min-h-screen flex flex-col items-center justify-center gap-6 px-6 py-10">
      <section className="w-full max-w-md flex flex-col gap-4">
        <p className="heading-sub text-[10px]">404</p>
        <h1 className="font-mono font-bold text-2xl tracking-tight">No page at this address.</h1>
        <RuleDivider />
        <p className="text-sm font-sans text-muted-foreground leading-snug">
          The composer, the live totals and your history all start from the home page.
        </p>
        <Link
          href="/"
          className="self-start font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors"
        >
          back to the composer
        </Link>
      </section>
    </main>
  );
}
