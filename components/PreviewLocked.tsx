'use client';

import { RefreshCw } from 'lucide-react';
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
        <p className="text-sm text-muted-foreground leading-snug">
          A free taste of the opening. Pay $0.05 to generate your full thread —
          freshly written and fact-checked.
        </p>
      </div>

      <Card className="p-4">
        <p className="whitespace-pre-wrap text-sm">{firstTweet}</p>
      </Card>

      <div className="relative flex flex-col gap-2" aria-hidden>
        {Array.from({ length: Math.min(Math.max(lockedCount, 0), 4) }).map((_, i) => (
          <Card key={i} className="p-4 select-none">
            <div className="h-3 w-3/4 rounded bg-[hsl(var(--ink-faded)/0.25)] blur-[1.5px]" />
            <div className="mt-2 h-3 w-1/2 rounded bg-[hsl(var(--ink-faded)/0.2)] blur-[1.5px]" />
          </Card>
        ))}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-1.5 rounded-full border border-[hsl(var(--ink-faded))] bg-background/80 px-3 py-1 text-xs text-muted-foreground">
            ≈ {totalTweets} {totalTweets === 1 ? 'tweet' : 'tweets'} in the full thread
          </span>
        </div>
      </div>

      <Button onClick={onUnlock}>Generate full thread · $0.05</Button>

      <p className="text-xs text-muted-foreground text-center leading-snug">
        Generated fresh, so the final wording may differ from this sample.
      </p>

      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenerating}
        className="self-center inline-flex items-center gap-1.5 heading-sub text-[10px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
      >
        <RefreshCw size={11} className={regenerating ? 'animate-spin' : ''} aria-hidden />
        {regenerating ? 'Regenerating…' : 'Regenerate sample'}
      </button>
    </section>
  );
}
