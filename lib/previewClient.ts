// Client helper: ask the server for a free first-tweet preview. Returns null
// on ANY non-success (unavailable, error, network) so the caller can cleanly
// fall back to the pay-first flow — a failed preview must never block paying.
import type { EventContext } from '@/lib/eventContext';

export interface PreviewArgs {
  mode: 0 | 1 | 2 | 3 | 4;
  walletAddress: string;
  topic?: string; // Mode 0 = topic; Mode 2 = token ticker
  audience?: 'beginner' | 'intermediate' | 'advanced';
  eventDescription?: string;
  angle?: 'bullish' | 'bearish' | 'skeptical';
  eventContext?: EventContext | null;
}

export interface PreviewResult {
  firstTweet: string;
  totalTweets: number;
}

async function postPreview(body: unknown): Promise<PreviewResult | null> {
  try {
    const res = await fetch('/api/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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

export function fetchPreview(args: PreviewArgs): Promise<PreviewResult | null> {
  return postPreview(args);
}

// Pre-connect landing taste: no wallet yet, Educational mode only. The server
// gates this on IP + global budget. Same null-on-any-failure contract so the
// landing falls back cleanly to the connect CTA.
export function fetchGuestPreview(topic: string): Promise<PreviewResult | null> {
  return postPreview({ mode: 0, topic, audience: 'beginner' });
}
