'use client';

import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { fetchGuestPreview, type PreviewResult } from '@/lib/previewClient';
import { track } from '@/lib/funnel';

/**
 * Pre-connect free taste on the landing. A guest types a topic and gets the
 * first tweet of an Educational thread for free — no wallet required — then the
 * connect CTA becomes the unlock. Every failure (rate limit, network, empty
 * preview) falls back silently to the connect flow: a missing sample must never
 * block the user from paying. `onUnlock` opens the wallet connect modal.
 */
export function GuestTaste({ onUnlock }: { onUnlock?: () => void }) {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [failed, setFailed] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setFailed(false);
    // Guest preview = the `preview` funnel stage with no wallet; connected
    // previews carry a wallet, so the two are distinguishable downstream.
    track('preview', { mode: 0 });
    const preview = await fetchGuestPreview(trimmed);
    setLoading(false);
    if (preview) setResult(preview);
    else setFailed(true);
  }

  if (result) {
    const locked = Math.max(result.totalTweets - 1, 0);
    return (
      <div className="w-full flex flex-col gap-2">
        <p className="heading-sub text-[10px]">Sample · First tweet free</p>
        <Card className="p-4">
          <p className="whitespace-pre-wrap font-sans text-sm">{result.firstTweet}</p>
        </Card>
        <p className="text-xs font-sans text-muted-foreground text-center leading-snug">
          {locked > 0 ? `+${locked} more ${locked === 1 ? 'tweet' : 'tweets'} — ` : ''}
          connect your wallet to unlock &amp; keep the full thread for{' '}
          <span className="font-mono text-money">$0.05</span>.
        </p>
        <button
          type="button"
          onClick={() => {
            setResult(null);
            setTopic('');
          }}
          className="self-center font-mono text-[11px] text-muted-foreground hover:text-primary transition-colors"
        >
          try another topic
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full flex flex-col gap-2">
      <Input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Type a topic — e.g. what are zk-rollups"
        maxLength={100}
        disabled={loading}
        aria-label="Topic for a free sample thread"
      />
      <Button type="submit" variant="outline" disabled={loading || !topic.trim()} className="w-full group">
        {loading ? (
          <>
            <Loader2 size={16} className="animate-spin" aria-hidden />
            Writing your first tweet…
          </>
        ) : (
          <>
            Get a free first tweet
            <ArrowRight
              size={16}
              className="transition-transform group-hover:translate-x-0.5"
              aria-hidden
            />
          </>
        )}
      </Button>
      {failed && (
        <p className="text-xs font-sans text-muted-foreground text-center leading-snug">
          Couldn’t load a sample right now —{' '}
          <button
            type="button"
            onClick={onUnlock}
            disabled={!onUnlock}
            className="underline hover:text-primary transition-colors disabled:opacity-50"
          >
            connect your wallet
          </button>{' '}
          to generate your thread.
        </p>
      )}
    </form>
  );
}
