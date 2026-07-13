// Builds the text posted to X for the FIRST tweet, optionally appending a
// CoinOp attribution. Attribution is added ONLY here (at share time), never
// to the user's editable tweets. The 280-char cap is approximated with string
// length: X actually weighs any URL as 23 chars (t.co) and the ✍️ emoji as 2,
// so `.length` over-counts the URL — that is safe, because the only effect of
// over-counting is dropping the attribution, never truncating the user's text.
// The live app. NOT shippost.app — that domain is parked DNS and does not
// resolve, so a share link pointing at it is a dead link in someone else's feed.
const DEFAULT_APP_URL = 'https://shippost-kappa.vercel.app';
const TWEET_MAX = 280;

export function shareAppUrl(): string {
  // `??` would only catch undefined. A Vercel env var stored as "" (the CLI
  // stdin bug, hit twice on this project) is present-but-empty and would slip
  // through, putting an empty URL in every share. Treat blank as absent.
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return fromEnv || DEFAULT_APP_URL;
}

// Web intent only — the twitter:// app scheme is NOT handled by the MiniPay
// Android webview (it tries to load it itself and dies with
// ERR_UNKNOWN_URL_SCHEME). On Android with the X app installed, verified App
// Links route this https URL into the app anyway; otherwise the web composer
// opens. Never navigate to a custom scheme from inside the webview.
export function tweetIntentUrl(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

export function buildShareText(
  firstTweet: string,
  opts: { attribution: boolean; appUrl?: string },
): string {
  if (!opts.attribution) return firstTweet;
  const url = opts.appUrl ?? shareAppUrl();
  const full = `${firstTweet}\n\n✍️ made with CoinOp — ${url}`;
  if (full.length <= TWEET_MAX) return full;
  const short = `${firstTweet}\n\nvia CoinOp ${url}`;
  if (short.length <= TWEET_MAX) return short;
  return firstTweet;
}
