'use client';

import { ArrowRight, Flame, GraduationCap, Coins, PenLine, GitCompare, Newspaper } from 'lucide-react';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { THREAD_PRICE_LABEL } from '@/lib/tokens';

interface Props {
  onSelect: (mode: 'educational' | 'hot-take' | 'news-breakdown' | 'token-analysis' | 'daily-recap' | 'comparison') => void;
  /**
   * The price read off the chain, already formatted. THREAD_PRICE_LABEL is the
   * fallback for the frames before that read lands — it is a local constant and
   * the on-chain price is settable, so the two can disagree. This screen is the
   * first place a price is quoted, and quoting one here and charging another on
   * PreviewLocked is the version of this bug the user actually sees.
   */
  priceLabel?: string;
}

interface Mode {
  id: 'educational' | 'hot-take' | 'news-breakdown' | 'token-analysis' | 'daily-recap' | 'comparison';
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  blurb: string;
  cost: string;
  badge?: string;
}

// Presentation order only — Hot Take leads as the flagship. The row number is
// this array's index (rendered below), and is DELIBERATELY NOT the on-chain
// mode id. Those ids are append-only and emitted in the `ThreadRequested`
// event: educational=0, hot-take=1, token-analysis=2, daily-recap=3,
// comparison=4, news-breakdown=5 (see lib/pipeline/modes/*). Reordering this
// array is free; renumbering an id would break the contract event mapping.
//
// There used to be a `numeral` field here (I/VI/II/…) that nothing rendered.
// It could not simply be wired up: its values are a per-mode roman tag in the
// order the modes were built, so printing them against this array would have
// read 01→I, 02→VI, 03→II. Deleted rather than resurrected.
const MODES: Mode[] = [
  {
    id: 'hot-take',
    label: 'Hot Take',
    Icon: Flame,
    blurb: 'React to news or a tweet with data. Search + market + fact-check inline.',
    cost: '$0.003',
    badge: 'grounded · fact-checked · live data',
  },
  {
    id: 'news-breakdown',
    label: 'News Breakdown',
    Icon: Newspaper,
    blurb: 'A news just dropped — what happened, why it matters, what to watch. No take, just clarity.',
    cost: '$0.003',
    badge: 'grounded · fact-checked · live data',
  },
  {
    id: 'educational',
    label: 'Educational Thread',
    Icon: GraduationCap,
    blurb: 'Explain one concept, end-to-end. e.g. "How EIP-712 typed signatures work".',
    cost: '$0.001',
  },
  {
    id: 'token-analysis',
    label: 'Token Analysis',
    Icon: Coins,
    blurb: 'Break down any token: price, mcap, catalysts. Live market data + fact-check inline.',
    cost: '$0.003',
    badge: 'grounded · live price · fact-checked',
  },
  {
    id: 'daily-recap',
    label: 'Daily Recap',
    Icon: PenLine,
    blurb: "Today's market in one thread — nothing to type. Top movers, headlines, one thing to watch.",
    cost: '$0.003',
    badge: 'one tap · live market · fact-checked',
  },
  {
    id: 'comparison',
    label: 'Chain Comparison',
    Icon: GitCompare,
    blurb: 'Two chains enter, one wins. TVL, momentum & ecosystem activity — the agent calls it.',
    cost: '$0.003',
    badge: 'grounded · TVL · fact-checked',
  },
];

export function ModePicker({ onSelect, priceLabel }: Props) {
  const price = priceLabel ?? THREAD_PRICE_LABEL;
  return (
    <TerminalPanel title="SELECT MODE" className="w-full max-w-md">
      {/* The one number the user is charged, stated once and up front. It is
          flat across modes, so repeating it per row would be noise — the
          failure this fixes is the opposite one: the agent's own x402 outlay
          sat in every row's price slot, in money-amber, six times over, while
          the price actually charged appeared once in a footer. The biggest
          money number on the menu was the one nobody pays. */}
      <div className="mb-3 flex items-baseline justify-between rounded-md border border-money/25 bg-money/5 px-3 py-2">
        <span className="heading-sub text-[10px]">You pay · flat</span>
        <span className="font-mono font-bold text-money">
          {price}
          <span className="font-normal text-[10px] text-muted-foreground"> /thread</span>
        </span>
      </div>

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
                <ArrowRight size={14} className="text-muted-foreground" aria-hidden />
              </div>
              <p className="mt-1.5 pl-[3.35rem] text-xs font-sans text-muted-foreground leading-snug">
                {m.blurb}
              </p>
              {/* The agent's outlay stays visible — watching it buy its own
                  research is the point of the product — but as a spec on the
                  meta line, in muted grey, not in money-amber in the slot
                  where a price belongs. */}
              <p className="mt-1 pl-[3.35rem] text-[10px] tracking-wide leading-snug">
                <span className="text-muted-foreground">agent spends {m.cost}</span>
                {m.badge && <span className="text-primary/70"> · {m.badge}</span>}
              </p>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] font-sans text-muted-foreground text-center">
        mode only changes the agent&apos;s recipe — never the price
      </p>
    </TerminalPanel>
  );
}
