'use client';

import * as React from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { ArrowRight, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InkDivider } from './InkDivider';
import { Marginalia } from './Marginalia';
import { IllumGraduationCap, IllumFlame, IllumCoin } from './IllumIcons';
import { SAMPLE_THREAD } from '@/lib/sampleThread';

/**
 * Pre-connect title page. Reads top-to-bottom like the opening folio of a
 * Renaissance codex: synopsis (Argumentum) with drop-cap, three-mode table of
 * contents (Index Modorum), pricing ledger (Liber Rationum), and a single
 * primary CTA. Each block fades up in sequence so the page composes itself
 * the way ink would land on parchment.
 */
export function LandingHero() {
  const { openConnectModal } = useConnectModal();

  return (
    <section className="relative w-full max-w-md isolate flex flex-col gap-5">
      {/* Decorative folio numeral bleeding off the upper-right margin —
          parchment-only watermark, hidden in MiniPay dark mode (LandingHero
          itself only renders on web, but the dark variant keeps it consistent
          if the user toggles). */}
      <span
        aria-hidden
        className="absolute -top-8 -right-2 font-display italic text-[9.5rem] leading-none text-[hsl(var(--ink-deep))] opacity-[0.06] dark:opacity-[0.08] select-none pointer-events-none -z-10"
      >
        0
      </span>

      {/* I. Argumentum — synopsis with drop-cap */}
      <div className="reveal flex flex-col gap-3" style={{ animationDelay: '0.3s' }}>
        <p className="heading-sub text-[10px]">Synopsis · Folio 0</p>
        <p className="font-display italic text-xl leading-[1.42] drop-cap text-foreground">
          A small agent reads the wires and forges an X thread for $0.05. Paid
          in stable, split on-chain, settled in real time.
        </p>
        <InkDivider />
      </div>

      {/* I½. Specimen — show the goods before the mechanics. A read-only
          exhibit reusing PreviewLocked's vocabulary (opening tweet + blurred
          locked stack); the real unlock lives behind the CTA below. */}
      <div className="reveal flex flex-col gap-3" style={{ animationDelay: '0.7s' }}>
        <div className="flex items-baseline justify-between">
          <p className="heading-sub text-[10px]">Specimen · A finished leaf</p>
          <span className="heading-sub text-[10px]">{SAMPLE_THREAD.mode}</span>
        </div>
        <Card className="p-4">
          <p className="whitespace-pre-wrap text-sm">{SAMPLE_THREAD.firstTweet}</p>
        </Card>
        <div className="relative flex flex-col gap-2" aria-hidden>
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i} className="p-4 select-none">
              <div className="h-3 w-3/4 rounded bg-[hsl(var(--ink-faded)/0.25)] blur-[1.5px]" />
              <div className="mt-2 h-3 w-1/2 rounded bg-[hsl(var(--ink-faded)/0.2)] blur-[1.5px]" />
            </Card>
          ))}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="flex items-center gap-1.5 rounded-full border border-[hsl(var(--ink-faded))] bg-background/80 px-3 py-1 text-xs text-muted-foreground">
              <Lock size={12} aria-hidden />
              {SAMPLE_THREAD.total - 1} more tweets in the full thread
            </span>
          </div>
        </div>
        <InkDivider />
      </div>

      {/* II. Index Modorum — three-mode TOC, leader-dot rhythm. Order, numerals
          and costs mirror ModePicker so the pre-connect page and the picker
          tell the same story. */}
      <div
        className="reveal flex flex-col gap-3"
        style={{ animationDelay: '1.1s' }}
      >
        <div className="flex items-baseline justify-between">
          <p className="heading-sub text-[10px]">Modes · Three styles</p>
          <span className="heading-sub text-[10px]">x402 budget</span>
        </div>
        <ModeEntry
          numeral="I"
          Icon={IllumFlame}
          title="Hot Take"
          blurb="React to news with data inline."
          cost="$0.003"
        />
        <ModeEntry
          numeral="II"
          Icon={IllumGraduationCap}
          title="Educational"
          blurb="Explain a concept, end-to-end."
          cost="$0.001"
        />
        <ModeEntry
          numeral="III"
          Icon={IllumCoin}
          title="Token Analysis"
          blurb="Break down any token — price, mcap, catalysts."
          cost="$0.003"
        />
        <InkDivider />
      </div>

      {/* III. Liber Rationum — pricing breakdown */}
      <div
        className="reveal flex flex-col gap-2"
        style={{ animationDelay: '1.5s' }}
      >
        <p className="heading-sub text-[10px]">
          Ledger · Where the $0.05 goes
        </p>
        <ul className="flex flex-col gap-1.5 text-sm mt-1">
          <LedgerLine left="You pay" right="$0.050" bold />
          <li className="my-0.5" aria-hidden>
            <InkDivider />
          </li>
          <LedgerLine left="→ Agent wallet" hint="50%" right="$0.025" />
          <LedgerLine left="→ Treasury" hint="40%" right="$0.020" />
          <LedgerLine left="→ Reserve" hint="10%" right="$0.005" />
          <li className="my-0.5" aria-hidden>
            <InkDivider />
          </li>
          <li className="text-xs text-muted-foreground leading-snug">
            Agent then spends $0.001–3 on x402 calls (Groq, Serper, CoinGecko).
            The remainder is its profit; daily cap $50/token.
          </li>
        </ul>
      </div>

      {/* IV. CTA — Take up the quill */}
      <div
        className="reveal flex flex-col gap-2.5 mt-3"
        style={{ animationDelay: '1.9s' }}
      >
        <Button
          size="lg"
          onClick={openConnectModal}
          disabled={!openConnectModal}
          className="w-full group"
        >
          Take up the quill
          <ArrowRight
            size={16}
            className="transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Button>
        <Marginalia side="right">
          Or sign with the chip in the page corner ↗
        </Marginalia>
      </div>

      <style jsx>{`
        @keyframes landing-reveal {
          0% {
            opacity: 0;
            transform: translateY(14px);
            filter: blur(2.5px);
          }
          100% {
            opacity: 1;
            transform: translateY(0);
            filter: blur(0);
          }
        }
        .reveal {
          opacity: 0;
          animation: landing-reveal 0.7s cubic-bezier(0.2, 0.6, 0.2, 1) forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .reveal {
            animation-duration: 0.01ms;
            animation-delay: 0ms !important;
          }
        }
      `}</style>
    </section>
  );
}

interface ModeEntryProps {
  numeral: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  blurb: string;
  cost: string;
}

function ModeEntry({ numeral, Icon, title, blurb, cost }: ModeEntryProps) {
  return (
    <div className="group flex items-start gap-3">
      <span
        aria-hidden
        className="font-display italic text-3xl leading-none w-7 shrink-0 self-center text-[hsl(var(--ink-faded))] group-hover:text-primary transition-colors"
      >
        {numeral}
      </span>
      <Icon
        size={20}
        className="self-center shrink-0 text-[hsl(var(--ink-faded))] group-hover:text-primary transition-colors"
      />
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <p className="font-display italic text-base leading-tight">{title}</p>
          <span
            aria-hidden
            className="flex-1 border-b border-dotted border-[hsl(var(--ink-faded))] mb-1 opacity-50"
          />
          <span className="font-mono text-[11px] text-[hsl(var(--ink-faded))] shrink-0">
            {cost}
          </span>
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          {blurb}
        </p>
      </div>
    </div>
  );
}

interface LedgerLineProps {
  left: string;
  right: string;
  bold?: boolean;
  hint?: string;
}

function LedgerLine({ left, right, bold, hint }: LedgerLineProps) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        className={
          bold ? 'font-semibold text-foreground' : 'text-foreground'
        }
      >
        {left}
      </span>
      {hint && (
        <span className="font-mono text-[11px] text-[hsl(var(--ink-faded))]">
          {hint}
        </span>
      )}
      <span
        aria-hidden
        className="flex-1 border-b border-dotted border-[hsl(var(--ink-faded))] mb-1 opacity-50"
      />
      <span
        className={
          'font-mono ' +
          (bold ? 'font-semibold text-foreground' : 'text-foreground')
        }
      >
        {right}
      </span>
    </li>
  );
}
