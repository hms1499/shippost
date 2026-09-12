'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { AgentTraceReplay } from '@/components/AgentTraceReplay';
import { GuestTaste } from '@/components/GuestTaste';
import { PublicStatsStrip } from '@/components/PublicStatsStrip';
import { SpecPlate } from '@/components/SpecPlate';
import { THREAD_PRICE_LABEL } from '@/lib/tokens';
import { PAGE_SHELL_CLASS } from '@/lib/layout';

/**
 * Pre-connect landing — the machine in attract mode.
 *
 * A coin-op machine nobody is playing does three things: it demos itself, it
 * shows its counter, and it waits for a coin. This page is that state, in that
 * order — thesis, counter, then free play beside the machine mid-run. MiniPay
 * auto-connects and never reaches here (HomeClient), so this is the web
 * surface, where a stranger decides in seconds whether any of it is real.
 *
 * Desktop: free play left, the running machine right. Mobile: the same two,
 * stacked — free play first, so the machine still cannot out-shout the one
 * thing to do, but it is no longer hidden behind a tap. It used to be: on the
 * only device MiniPay runs on, the single artefact that proves any of this is
 * real sat behind a disclosure button, and AgentTraceReplay now starts on
 * scroll-into-view so it is caught running rather than already finished. The
 * spec plate closes it, the way a machine carries its plate on the back.
 */
export function LandingHero() {
  const { openConnectModal } = useConnectModal();

  return (
    <section
      className={`${PAGE_SHELL_CLASS} relative grid grid-cols-12 gap-x-6 gap-y-8 lg:gap-x-8 lg:gap-y-10 scanlines rounded-lg`}
    >
      <div className="order-1 col-span-12 text-center flex flex-col items-center gap-3 lg:col-start-2 lg:col-span-10">
        <h2 className="font-mono font-bold text-[clamp(1.9rem,5.4vw,3.25rem)] leading-[0.98] tracking-[-0.03em]">
          One coin in. <span className="text-primary">One thread out.</span>
        </h2>
        {/* This used to end "and only if you keep it", which the product does
            not do: payment happens on PreviewLocked, BEFORE the full thread
            exists, and a refund covers a failed run — not a thread you read and
            disliked. The free opening tweet and the refund are both real, so
            the pitch is made out of those instead of a promise the flow breaks
            two taps later. */}
        <p className="text-base text-muted-foreground max-w-xl font-sans leading-relaxed [text-wrap:balance]">
          Type a topic — say &quot;what are zk-rollups&quot;. Read the opening tweet free.
          Pay <span className="font-mono text-money">{THREAD_PRICE_LABEL}</span> and the agent
          buys its own research, call by call, then writes the rest. If the run fails, you get
          it all back.
        </p>
      </div>

      {/* Mobile is action-first: the free taste comes before proof and demo so
          the primary CTA stays inside a short phone's first viewport. Desktop
          keeps proof directly under the pitch, then places play and demo side
          by side. */}
      <div className="order-3 col-span-12 w-full lg:order-2">
        <PublicStatsStrip />
      </div>

      <div className="order-2 col-span-12 w-full flex flex-col gap-2 lg:order-3 lg:col-span-7">
        <p className="heading-sub text-xs">Free play</p>
        <GuestTaste onUnlock={openConnectModal} />
      </div>

      <aside className="order-4 col-span-12 w-full flex flex-col gap-2 lg:order-3 lg:col-span-5">
        <p className="heading-sub text-xs">The machine, mid-run</p>
        <AgentTraceReplay />
        <p className="text-xs font-mono text-muted-foreground leading-snug">
          One canned pass. No payment, no on-chain spend.
        </p>
      </aside>

      <div className="order-5 col-span-12 lg:order-4">
        <SpecPlate />
      </div>
    </section>
  );
}
