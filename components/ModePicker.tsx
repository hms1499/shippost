'use client';

import { ArrowRight, Flame, GraduationCap, Coins, PenLine } from 'lucide-react';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';

interface Props {
  onSelect: (mode: 'educational' | 'hot-take' | 'token-analysis' | 'daily-recap') => void;
}

interface Mode {
  id: 'educational' | 'hot-take' | 'token-analysis' | 'daily-recap';
  numeral: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  blurb: string;
  cost: string;
  badge?: string;
}

// Presentation order only. The `numeral` (I/II/III/IV) is the curated reading
// order on this screen — Hot Take leads as the flagship — and is DELIBERATELY
// NOT the on-chain mode id. Those ids are append-only and emitted in the
// `ThreadRequested` event: educational=0, hot-take=1, token-analysis=2,
// daily-recap=3 (see lib/pipeline/modes/*). Renumbering for cosmetic alignment
// would break the contract event mapping — change the display numeral here,
// never the id.
const MODES: Mode[] = [
  {
    id: 'hot-take',
    numeral: 'I',
    label: 'Hot Take',
    Icon: Flame,
    blurb: 'React to news or a tweet with data. Search + market + fact-check inline.',
    cost: '$0.003',
    badge: 'grounded · fact-checked · live data',
  },
  {
    id: 'educational',
    numeral: 'II',
    label: 'Educational Thread',
    Icon: GraduationCap,
    blurb: 'Explain one concept, end-to-end. e.g. "How EIP-712 typed signatures work".',
    cost: '$0.001',
  },
  {
    id: 'token-analysis',
    numeral: 'III',
    label: 'Token Analysis',
    Icon: Coins,
    blurb: 'Break down any token: price, mcap, catalysts. Live market data + fact-check inline.',
    cost: '$0.003',
    badge: 'grounded · live price · fact-checked',
  },
  {
    id: 'daily-recap',
    numeral: 'IV',
    label: 'Daily Recap',
    Icon: PenLine,
    blurb: "Today's market in one thread — nothing to type. Top movers, headlines, one thing to watch.",
    cost: '$0.003',
    badge: 'one tap · live market · fact-checked',
  },
];

export function ModePicker({ onSelect }: Props) {
  return (
    <TerminalPanel title="SELECT MODE" className="w-full max-w-md">
      <ul className="flex flex-col gap-2">
        {MODES.map((m, i) => (
          <li key={m.id}>
            <button
              onClick={() => onSelect(m.id)}
              className="w-full text-left rounded-md border border-border bg-background/50 p-3 font-mono transition-colors hover:border-primary/50 hover:bg-primary/5 active:bg-primary/10"
            >
              <div className="flex items-center gap-2.5">
                <span className="text-muted-foreground text-[10px] w-6">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <m.Icon size={16} className="text-primary shrink-0" aria-hidden />
                <span className="font-bold text-sm flex-1">{m.label}</span>
                <span className="text-[10px] text-muted-foreground">
                  agent <span className="text-money">{m.cost}</span>
                </span>
                <ArrowRight size={14} className="text-muted-foreground" aria-hidden />
              </div>
              <p className="mt-1.5 pl-[3.35rem] text-xs font-sans text-muted-foreground leading-snug">
                {m.blurb}
              </p>
              {m.badge && (
                <p className="mt-1 pl-[3.35rem] text-[10px] text-primary/70 tracking-wide">
                  [{m.badge}]
                </p>
              )}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] font-sans text-muted-foreground text-center">
        flat <span className="font-mono text-money">$0.05</span>/thread — mode only changes the agent&apos;s recipe
      </p>
    </TerminalPanel>
  );
}
