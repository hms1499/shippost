'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentTraceReplay } from '@/components/AgentTraceReplay';
import { TraceNote } from '@/components/terminal/TraceNote';

/**
 * Pre-connect landing hero. Terminal mission-control framing: headline copy,
 * then a looping replay of the real AgentTrace screen (the actual generating
 * UI driven by a canned run through the production reducer — zero spend),
 * then the single CTA.
 */
export function LandingHero() {
  const { openConnectModal } = useConnectModal();

  return (
    <section className="relative w-full max-w-md flex flex-col items-center gap-6">
      <div className="text-center flex flex-col items-center gap-2">
        <p className="heading-sub text-[10px]">SHIPPOST // AGENT</p>
        <h1 className="text-3xl font-bold tracking-tight">
          Your agent writes, <span className="text-primary">pays</span>, ships.
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs font-mono">
          Pay <span className="text-money">$0.05</span> once — an on-chain agent pays
          AI services per call (x402) and delivers a ready-to-post X thread.
        </p>
      </div>

      <AgentTraceReplay />

      <div className="flex flex-col gap-2.5 w-full">
        <Button
          size="lg"
          onClick={openConnectModal}
          disabled={!openConnectModal}
          className="w-full group"
        >
          Connect wallet
          <ArrowRight
            size={16}
            className="transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Button>
        <TraceNote side="right">or sign in from the corner ↗</TraceNote>
      </div>
    </section>
  );
}
