'use client';

import { useState } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { fetchGuestPreview } from '@/lib/previewClient';
import { saveGuestTopic, takeGuestTopic } from '@/lib/guestSession';
import { track } from '@/lib/funnel';
import { THREAD_PRICE_LABEL } from '@/lib/tokens';

/**
 * Pre-connect free taste on the landing. A guest types a topic and gets the
 * first tweet of an Educational thread for free — no wallet required — then the
 * connect CTA becomes the unlock. Rate-limit and infra failure are worded
 * differently so a spent daily budget is not read as an outage.
 */
export function GuestTaste({ onUnlock }: { onUnlock?: () => void }) {
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ firstTweet: string; totalTweets: number } | null>(null);
  const [failKind, setFailKind] = useState<'limited' | 'error' | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = topic.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setFailKind(null);
    track('preview', { mode: 0 });
    const preview = await fetchGuestPreview(trimmed);
    setLoading(false);
    if (preview.status === 'ok') {
      saveGuestTopic(trimmed);
      setResult({ firstTweet: preview.firstTweet, totalTweets: preview.totalTweets });
    } else {
      setFailKind(preview.status);
    }
  }

  if (result) {
    const locked = Math.max(result.totalTweets - 1, 0);
    return (
      <div className="w-full flex flex-col gap-3">
        <p className="heading-sub text-[10px]">First tweet, free</p>
        <Card className="p-4">
          <p className="whitespace-pre-wrap font-sans text-sm">{result.firstTweet}</p>
        </Card>
        <p className="text-xs font-sans text-muted-foreground leading-snug">
          {locked > 0
            ? `+${locked} more ${locked === 1 ? 'tweet' : 'tweets'} locked.`
            : 'Connect to keep this thread.'}{' '}
          Pay <span className="font-mono text-money">{THREAD_PRICE_LABEL}</span> only if you keep it.
        </p>
        <Button size="lg" onClick={onUnlock} disabled={!onUnlock} className="w-full group">
          Connect to unlock
          {locked > 0 ? ` ${locked} more` : ''}
          <ArrowRight
            size={16}
            className="transition-transform group-hover:translate-x-0.5"
            aria-hidden
          />
        </Button>
        <button
          type="button"
          onClick={() => {
            takeGuestTopic();
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
    <form onSubmit={handleSubmit} className="w-full h-full flex flex-col gap-2">
      <Input
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
        placeholder="Type a topic — e.g. what are zk-rollups"
        maxLength={100}
        disabled={loading}
        aria-label="Topic for a free sample thread"
      />
      <Button type="submit" disabled={loading || !topic.trim()} className="w-full group">
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
      <p className="font-mono text-[11px] text-muted-foreground leading-snug">
        Educational mode · a few a day · no wallet
      </p>
      {failKind === 'limited' && (
        <p className="text-xs font-sans text-muted-foreground leading-snug">
          Out of free tastes for now.{' '}
          <button
            type="button"
            onClick={onUnlock}
            disabled={!onUnlock}
            className="underline hover:text-primary transition-colors disabled:opacity-50"
          >
            Connect your wallet
          </button>{' '}
          to preview every mode.
        </p>
      )}
      {failKind === 'error' && (
        <p className="text-xs font-sans text-muted-foreground leading-snug">
          Couldn&apos;t write a sample right now.{' '}
          <button
            type="button"
            onClick={onUnlock}
            disabled={!onUnlock}
            className="underline hover:text-primary transition-colors disabled:opacity-50"
          >
            Connect
          </button>{' '}
          and try the full preview.
        </p>
      )}
      <button
        type="button"
        onClick={onUnlock}
        disabled={!onUnlock}
        // Pinned to the bottom of the column so it lands on the demo caption's
        // line opposite; one alignment down the whole column.
        className="self-start mt-auto pt-4 font-mono text-[11px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
      >
        or connect to pick a mode
      </button>
    </form>
  );
}
