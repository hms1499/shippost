// Client helper: ask the server for a free first-tweet preview. Returns null
// on ANY non-success (unavailable, error, network) so the caller can cleanly
// fall back to the pay-first flow — a failed preview must never block paying.
export interface PreviewArgs {
  mode: 0 | 1;
  walletAddress: string;
  topic?: string;
  audience?: 'beginner' | 'intermediate' | 'advanced';
  eventDescription?: string;
  angle?: 'bullish' | 'bearish' | 'skeptical';
}

export interface PreviewResult {
  firstTweet: string;
  totalTweets: number;
}

export async function fetchPreview(args: PreviewArgs): Promise<PreviewResult | null> {
  try {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<PreviewResult> & { available?: boolean };
    if (data.available === false) return null;
    if (typeof data.firstTweet !== 'string' || typeof data.totalTweets !== 'number') return null;
    return { firstTweet: data.firstTweet, totalTweets: data.totalTweets };
  } catch {
    return null;
  }
}
