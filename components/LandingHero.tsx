'use client';

import { useEffect, useState } from 'react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { AgentTraceReplay } from '@/components/AgentTraceReplay';
import { GuestTaste } from '@/components/GuestTaste';
import { THREAD_PRICE_LABEL } from '@/lib/tokens';

const MD_UP = '(min-width: 768px)';

/**
 * Pre-connect landing. One action on the fold — type a topic, get a free
 * first tweet. Connect appears after the sample (or as a quiet fallback).
 * Desktop: taste left, generating-screen demo right. Mobile: demo is a
 * disclosure under the fold so it cannot out-shout the form.
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

        <aside className="w-full flex flex-col gap-2">
          {desktop ? (
            <p className="heading-sub text-[10px]">How a paid run looks</p>
          ) : (
            <button
              type="button"
              onClick={() => setDemoOpen((o) => !o)}
              aria-expanded={demoOpen}
              className="self-start heading-sub text-[10px] hover:text-primary transition-colors"
            >
              {demoOpen ? 'Hide paid-run demo' : 'How a paid run looks'}
            </button>
          )}
          {showDemo && (
            <>
              <AgentTraceReplay />
              <p className="text-[11px] font-mono text-muted-foreground leading-snug">
                Demo of the generating screen — one canned pass, no payment, no on-chain spend.
              </p>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
