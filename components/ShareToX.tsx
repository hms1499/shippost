'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  tweets: string[];
}

// Open the native X composer when the app is installed (the common case in
// the MiniPay Android webview); fall back to the web intent if nothing
// handles the twitter:// scheme. When the app takes the foreground the page
// goes hidden — that's our signal to cancel the web fallback.
function postFirstTweet(text: string): void {
  const encoded = encodeURIComponent(text);
  const webUrl = `https://twitter.com/intent/tweet?text=${encoded}`;
  const appUrl = `twitter://post?message=${encoded}`;

  let settled = false;
  const fallback = window.setTimeout(() => {
    if (!settled) window.open(webUrl, '_blank', 'noopener,noreferrer');
  }, 1500);

  const onVis = () => {
    if (document.hidden) {
      settled = true;
      window.clearTimeout(fallback);
      document.removeEventListener('visibilitychange', onVis);
    }
  };
  document.addEventListener('visibilitychange', onVis);

  window.location.href = appUrl;
}

export function ShareToX({ tweets }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyAll() {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(tweets.join('\n\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError('Clipboard blocked — long-press a tweet card to copy manually.');
    }
  }

  const first = tweets[0] ?? '';
  const rest = tweets.slice(1);

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold">Share to X</h3>

      <p className="text-xs text-muted-foreground">
        X mobile can&apos;t post a full thread at once. Tap <b>Post first tweet</b> below — then in
        X, use the <b>+</b> button under your own tweet to add each follow-up from the clipboard.
      </p>

      <Button onClick={() => postFirstTweet(first)}>
        Post first tweet in X →
      </Button>

      <Button variant="outline" onClick={copyAll}>
        {copied ? (
          <span className="flex items-center gap-1.5">
            Copied
            <Check size={14} aria-hidden />
          </span>
        ) : (
          `Copy all ${tweets.length} tweets`
        )}
      </Button>

      {copyError && <p className="text-xs text-destructive">{copyError}</p>}

      {rest.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Preview follow-ups ({rest.length})
          </summary>
          <ol className="mt-2 flex flex-col gap-2 pl-4 list-decimal">
            {rest.map((t, i) => (
              <li key={i} className="whitespace-pre-wrap">
                {t}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}
