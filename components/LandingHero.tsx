'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AgentTraceReplay } from '@/components/AgentTraceReplay';

/**
 * Pre-connect landing hero. Terminal mission-control framing: headline copy,
 * then a looping replay of the real AgentTrace screen (the actual generating
 * UI driven by a canned run through the production reducer — zero spend),
 * then the single CTA.
 */
export function LandingHero() {
  const { openConnectModal } = useConnectModal();

  return (
    <section className="relative w-full max-w-md flex flex-col items-center gap-6 scanlines rounded-lg">
      <div className="text-center flex flex-col items-center gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          One coin in. <span className="text-primary">One thread out.</span>
        </h1>
        <p className="text-sm text-muted-foreground max-w-xs font-sans">
          Type a topic, get a ready-to-post X thread in ~20s. Pay{' '}
          <span className="font-mono text-money">$0.05</span> only if you keep it.
        </p>
      </div>

      <div className="w-full flex flex-col items-center gap-2">
        <AgentTraceReplay />
        <p className="text-[11px] font-mono text-muted-foreground text-center max-w-xs leading-snug">
          A real run: the agent pays each AI service on-chain via x402 micropayments.
        </p>
      </div>

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
      </div>
    </section>
  );
}
