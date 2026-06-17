'use client';

import Link from 'next/link';
import { useAccount } from 'wagmi';
import { BarChart3, History } from 'lucide-react';

interface IndexEntry {
  numeral: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  description: string;
  href: string;
  /** account-scoped entries only render once a wallet is connected */
  requiresConnection?: boolean;
}

const ENTRIES: IndexEntry[] = [
  {
    numeral: 'I',
    Icon: BarChart3,
    label: 'Public Stats',
    description: 'Live metrics, recent threads, x402 settlements.',
    href: '/stats',
  },
  {
    numeral: 'II',
    Icon: History,
    label: 'My History',
    description: "Threads you've composed on this chain.",
    href: '/history',
    requiresConnection: true,
  },
];

/**
 * Colophon-style navigation index. A codex closes with a colophon listing its
 * contents; this footer mirrors that — illuminated numerals, leader rows. Lives
 * outside the connect gate so Public Stats (which needs no wallet) is always
 * discoverable; account-scoped entries appear only once a wallet is sealed.
 */
export function ColophonIndex() {
  const { isConnected } = useAccount();
  const entries = ENTRIES.filter((e) => !e.requiresConnection || isConnected);

  return (
    <nav aria-label="Index" className="w-full flex flex-col gap-2">
      <p className="heading-sub text-[10px] self-center">— Index —</p>
      <ul className="flex flex-col gap-1.5">
        {entries.map((item) => {
          const { Icon } = item;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group no-underline flex items-stretch gap-4 p-2.5 rounded-md border border-transparent hover:border-[hsl(var(--ink-faded))] hover:bg-[hsl(var(--accent)/0.25)] transition-colors"
              >
                <div className="w-9 shrink-0 flex items-center justify-center font-display italic text-[2rem] leading-none text-[hsl(var(--ink-faded))] group-hover:text-primary transition-colors">
                  {item.numeral}
                </div>
                <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                  <div className="flex items-center gap-2">
                    <Icon
                      size={13}
                      className="text-[hsl(var(--ink-faded))] group-hover:text-primary transition-colors"
                    />
                    <p className="font-display italic text-base leading-tight">
                      {item.label}
                    </p>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">
                    {item.description}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
