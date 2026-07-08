'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { haptic } from '@/lib/haptics';
import { buildShareText, tweetIntentUrl } from '@/lib/shareText';

interface Props {
  tweets: string[];
}

// Open the X composer via the https web intent, synchronously inside the tap
// (popup blockers require the user gesture). With the X app installed,
// Android App Links route it into the native composer; otherwise the web
// composer opens. Never use the twitter:// scheme here — the MiniPay webview
// can't hand it off and shows ERR_UNKNOWN_URL_SCHEME.
function postFirstTweet(text: string): void {
  window.open(tweetIntentUrl(text), '_blank', 'noopener,noreferrer');
}

export function ShareToX({ tweets }: Props) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [credit, setCredit] = useState(true);

  async function copyAll() {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(tweets.join('\n\n'));
      setCopied(true);
      haptic('tick');
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

      <p className="text-xs font-sans text-muted-foreground">
        X mobile can&apos;t post a full thread at once. Tap <b>Post first tweet</b> below — then in
        X, use the <b>+</b> button under your own tweet to add each follow-up from the clipboard.
      </p>

      <Button onClick={() => postFirstTweet(buildShareText(first, { attribution: credit }))}>
        Post first tweet in X →
      </Button>

      <label className="flex items-center gap-2 text-xs text-muted-foreground select-none">
        <input
          type="checkbox"
          checked={credit}
          onChange={(e) => setCredit(e.target.checked)}
          className="accent-primary"
        />
        Add a small &#8220;made with CoinOp&#8221; credit to the first tweet
      </label>

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

      {copyError && <p className="text-xs font-sans text-destructive">{copyError}</p>}

      {rest.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            Preview follow-ups ({rest.length})
          </summary>
          <ol className="mt-2 flex flex-col gap-2 pl-4 list-decimal">
            {rest.map((t, i) => (
              <li key={i} className="whitespace-pre-wrap font-sans">
                {t}
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}
