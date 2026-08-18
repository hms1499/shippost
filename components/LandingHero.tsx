'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { AgentTraceReplay } from '@/components/AgentTraceReplay';
import { GuestTaste } from '@/components/GuestTaste';
import { THREAD_PRICE_LABEL } from '@/lib/tokens';

/**
 * Pre-connect landing. One action on the fold — type a topic, get a free
 * first tweet. Connect appears after the sample (or as a quiet fallback).
 * Desktop splits taste and the generating-screen demo; mobile stacks them.
 */
export function LandingHero() {
  const { openConnectModal } = useConnectModal();

  return (
    <section className="relative w-full max-w-4xl flex flex-col items-center gap-8 scanlines rounded-lg">
      <div className="text-center flex flex-col items-center gap-2">
        <p className="text-3xl font-bold tracking-tight">
          One coin in. <span className="text-primary">One thread out.</span>
        </p>
        <p className="text-sm text-muted-foreground max-w-md font-sans">
          Type a topic, get a ready-to-post X thread in ~20s. Pay{' '}
          <span className="font-mono text-money">{THREAD_PRICE_LABEL}</span> only if you keep it.
        </p>
      </div>

      <div className="w-full grid gap-8 md:grid-cols-2 md:items-start">
        <div className="w-full">
          <GuestTaste onUnlock={openConnectModal} />
        </div>

        <div className="w-full flex flex-col items-center gap-2">
          <AgentTraceReplay />
          <p className="text-[11px] font-mono text-muted-foreground text-center max-w-xs leading-snug">
            Demo of the generating screen — a canned run, no payment, no on-chain spend.
          </p>
        </div>
      </div>
    </section>
  );
}
