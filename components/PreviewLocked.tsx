'use client';

import { Lock, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  firstTweet: string;
  lockedCount: number;
  onUnlock: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
}

export function PreviewLocked({ firstTweet, lockedCount, onUnlock, onRegenerate, regenerating }: Props) {
  // lockedCount is "the rest"; the full thread is that plus the opening tweet.
  const totalTweets = Math.max(lockedCount, 0) + 1;
  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="heading-sub text-[10px]">Sample · First tweet free</p>
        <p className="text-sm font-sans text-muted-foreground leading-snug">
          A free taste of the opening. Pay <span className="font-mono text-money">$0.05</span> to
          generate your full thread — freshly written and fact-checked.
        </p>
      </div>

      <Card className="p-4">
        <p className="whitespace-pre-wrap font-sans text-sm">{firstTweet}</p>
      </Card>

      <div className="relative flex flex-col gap-2" aria-hidden>
        {Array.from({ length: Math.min(Math.max(lockedCount, 0), 4) }).map((_, i) => (
          <Card key={i} className="p-4 select-none border-l-2 border-l-money">
            <div className="h-3 w-3/4 rounded bg-muted-foreground/25 blur-[1.5px]" />
            <div className="mt-2 h-3 w-1/2 rounded bg-muted-foreground/20 blur-[1.5px]" />
          </Card>
        ))}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 py-1 text-xs font-mono text-muted-foreground">
            <Lock size={11} className="text-money" aria-hidden />
            unlocks after payment · ≈ {totalTweets} {totalTweets === 1 ? 'tweet' : 'tweets'}
          </span>
        </div>
      </div>

      <Button onClick={onUnlock}>
        Generate full thread · $0.05
      </Button>

      {/* Placed at the moment of hesitation: the refund promise the backend
          already keeps (ErrorSurface copy, refund queue) — the UI just says
          it out loud where the user decides to pay. */}
      <p className="text-center font-mono text-[11px] text-muted-foreground -mt-0.5">
        if the run fails · full refund · within 24h
      </p>

      <p className="text-xs font-sans text-muted-foreground text-center leading-snug">
        Generated fresh, so the final wording may differ from this sample.
      </p>

      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenerating}
        className="self-center inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
      >
        <RefreshCw size={11} className={regenerating ? 'animate-spin' : ''} aria-hidden />
        {regenerating ? 'Regenerating…' : 'Regenerate sample'}
      </button>
    </section>
  );
}
