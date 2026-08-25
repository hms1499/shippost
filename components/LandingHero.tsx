'use client';

import { useEffect, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { AgentTraceReplay } from '@/components/AgentTraceReplay';
import { GuestTaste } from '@/components/GuestTaste';
import { PublicStatsStrip } from '@/components/PublicStatsStrip';
import { SpecPlate } from '@/components/SpecPlate';
import { THREAD_PRICE_LABEL } from '@/lib/tokens';

const MD_UP = '(min-width: 768px)';

/**
 * Pre-connect landing — the machine in attract mode.
 *
 * A coin-op machine nobody is playing does three things: it demos itself, it
 * shows its counter, and it waits for a coin. This page is that state, in that
 * order — thesis, counter, then free play beside the machine mid-run. MiniPay
 * auto-connects and never reaches here (HomeClient), so this is the web
 * surface, where a stranger decides in seconds whether any of it is real.
 *
 * Desktop: free play left, the running machine right. Mobile: the machine is a
 * disclosure under the fold so it cannot out-shout the one thing to do. The
 * spec plate closes it, the way a machine carries its plate on the back.
 */
export function LandingHero() {
  const { openConnectModal } = useConnectModal();
  const [desktop, setDesktop] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(MD_UP);
    const update = () => setDesktop(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  const showDemo = desktop || demoOpen;

  return (
    <section className="relative w-full max-w-4xl flex flex-col items-center gap-8 md:gap-10 scanlines rounded-lg">
      <div className="text-center flex flex-col items-center gap-3">
        <h2 className="font-mono font-bold text-[clamp(1.9rem,5.4vw,3.25rem)] leading-[0.98] tracking-[-0.03em]">
          One coin in. <span className="text-primary">One thread out.</span>
        </h2>
        <p className="text-sm md:text-base text-muted-foreground max-w-xl font-sans leading-relaxed [text-wrap:balance]">
          Type a topic — say &quot;what are zk-rollups&quot;. The agent buys its own research call
          by call, then hands back an X thread you can post for{' '}
          <span className="font-mono text-money">{THREAD_PRICE_LABEL}</span>, and only if you
          keep it.
        </p>
      </div>

      <PublicStatsStrip />

      <div className="w-full grid gap-8 md:grid-cols-2 md:items-stretch">
        <div className="w-full flex flex-col gap-2">
          <p className="heading-sub text-[10px]">Free play</p>
          <GuestTaste onUnlock={openConnectModal} />
        </div>

        <aside className="w-full flex flex-col gap-2">
          {desktop ? (
            <p className="heading-sub text-[10px]">The machine, mid-run</p>
          ) : (
            <button
              type="button"
              onClick={() => setDemoOpen((o) => !o)}
              aria-expanded={demoOpen}
              aria-pressed={demoOpen}
              className="self-start heading-sub text-[10px] hover:text-primary transition-colors"
            >
              {demoOpen ? 'Hide the machine' : 'Watch the machine run'}
            </button>
          )}
          {showDemo && (
            <>
              <AgentTraceReplay />
              <p className="text-[11px] font-mono text-muted-foreground leading-snug">
                One canned pass. No payment, no on-chain spend.
              </p>
            </>
          )}
        </aside>
      </div>

      <SpecPlate />
    </section>
  );
}
