export type UrlKind = 'tweet' | 'news' | 'unknown';

export interface ParsedUrl {
  url: string;
  kind: UrlKind;
  tweetId?: string;
  host?: string;
}

const TWEET_RE = /^https?:\/\/(?:twitter|x)\.com\/[^\/]+\/status\/(\d+)/i;

export function parseUrl(input: string): ParsedUrl | null {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const m = trimmed.match(TWEET_RE);
  if (m) return { url: trimmed, kind: 'tweet', tweetId: m[1], host: url.host };

  return { url: trimmed, kind: 'news', host: url.host };
}

export function extractLikelyQuery(text: string, fallbackTopic: string): string {
  const cleaned = text
    .replace(/https?:\/\/\S+/g, '')
    .replace(/@\w+/g, '')
    .replace(/#\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallbackTopic;
}
