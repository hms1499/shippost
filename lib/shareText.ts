// Builds the text posted to X for the FIRST tweet, optionally appending a
// ShipPost attribution. Attribution is added ONLY here (at share time), never
// to the user's editable tweets. The 280-char cap is approximated with string
// length: X actually weighs any URL as 23 chars (t.co) and the ✍️ emoji as 2,
// so `.length` over-counts the URL — that is safe, because the only effect of
// over-counting is dropping the attribution, never truncating the user's text.
const DEFAULT_APP_URL = 'https://shippost.app';
const TWEET_MAX = 280;

export function shareAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? DEFAULT_APP_URL;
}

export function buildShareText(
  firstTweet: string,
  opts: { attribution: boolean; appUrl?: string },
): string {
  if (!opts.attribution) return firstTweet;
  const url = opts.appUrl ?? shareAppUrl();
  const full = `${firstTweet}\n\n✍️ made with ShipPost — ${url}`;
  if (full.length <= TWEET_MAX) return full;
  const short = `${firstTweet}\n\nvia ShipPost ${url}`;
  if (short.length <= TWEET_MAX) return short;
  return firstTweet;
}
