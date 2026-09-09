'use client';

import { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  Flame,
  GraduationCap,
  Coins,
  PenLine,
  GitCompare,
  Newspaper,
} from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
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

// Presentation order only — Hot Take leads as the flagship. The rendered row
// number follows the recommended/more presentation groups and is DELIBERATELY
// NOT the on-chain mode id. Those ids are append-only and emitted in the `ThreadRequested`
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

const RECOMMENDED_MODE_IDS = new Set<Mode['id']>([
  'hot-take',
  'news-breakdown',
  'token-analysis',
]);

export function ModePicker({ onSelect, priceLabel }: Props) {
  const price = priceLabel ?? THREAD_PRICE_LABEL;
  const [showAll, setShowAll] = useState(false);
  const reduced = useReducedMotion();
  const recommended = MODES.filter((mode) => RECOMMENDED_MODE_IDS.has(mode.id));
  const more = MODES.filter((mode) => !RECOMMENDED_MODE_IDS.has(mode.id));

  return (
    <TerminalPanel title="SELECT MODE" className="w-full max-w-md">
      {/* The one number the user is charged, stated once and up front. It is
          flat across modes, so repeating it per row would be noise — the
          failure this fixes is the opposite one: the agent's own x402 outlay
          sat in every row's price slot, in money-amber, six times over, while
          the price actually charged appeared once in a footer. The biggest
          money number on the menu was the one nobody pays. */}
      <div className="mb-3 flex items-baseline justify-between rounded-md border border-money/25 bg-money/5 px-3 py-2">
        <span className="heading-sub text-xs">You pay · flat</span>
        <span className="font-mono font-bold text-money">
          {price}
          <span className="font-normal text-xs text-muted-foreground"> /thread</span>
        </span>
      </div>

      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="heading-sub text-xs">Recommended</p>
        <span className="font-mono text-xs text-muted-foreground">3 modes</span>
      </div>
      <ModeList modes={recommended} startIndex={0} onSelect={onSelect} />

      <button
        type="button"
        aria-expanded={showAll}
        aria-controls="more-modes"
        onClick={() => setShowAll((current) => !current)}
        className="mt-2 flex min-h-11 w-full items-center justify-between rounded-md px-3 font-mono text-xs text-muted-foreground transition-colors hover:bg-primary/5 hover:text-primary active:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span>{showAll ? 'Hide more modes' : `Explore ${more.length} more modes`}</span>
        <ChevronDown
          size={16}
          className={`transition-transform ${showAll ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      <AnimatePresence initial={false}>
        {showAll && (
          <motion.div
            id="more-modes"
            initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduced ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0.01 : 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="pt-2">
              <p className="heading-sub mb-2 text-xs">More modes</p>
              <ModeList modes={more} startIndex={recommended.length} onSelect={onSelect} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <p className="mt-3 text-xs font-sans text-muted-foreground text-center">
        one flat price · mode only changes the agent&apos;s recipe
      </p>
    </TerminalPanel>
  );
}

function ModeList({
  modes,
  startIndex,
  onSelect,
}: {
  modes: Mode[];
  startIndex: number;
  onSelect: Props['onSelect'];
}) {
  return (
    <ul className="flex flex-col gap-2">
      {modes.map((mode, index) => (
        <li key={mode.id}>
          <button
            type="button"
            onClick={() => onSelect(mode.id)}
            className="w-full text-left rounded-md border border-border bg-background/50 p-3 font-mono transition-colors hover:border-primary/50 hover:bg-primary/5 active:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center gap-2.5">
              <span className="w-6 text-xs text-muted-foreground">
                {String(startIndex + index + 1).padStart(2, '0')}
              </span>
              <mode.Icon size={16} className="text-primary shrink-0" aria-hidden />
              <span className="font-bold text-sm flex-1">{mode.label}</span>
              <ArrowRight size={14} className="text-muted-foreground" aria-hidden />
            </div>
            <p className="mt-1.5 pl-[3.35rem] text-[13px] font-sans text-muted-foreground leading-snug">
              {mode.blurb}
            </p>
            <p className="mt-1 pl-[3.35rem] text-xs tracking-wide leading-snug">
              <span className="text-muted-foreground">included agent spend · {mode.cost}</span>
              {mode.badge && <span className="text-primary/80"> · {mode.badge}</span>}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}
