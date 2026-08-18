import { Redis } from '@upstash/redis';

export interface GuestPreviewCached {
  firstTweet: string;
  totalTweets: number;
}

const DEFAULT_TTL_SEC = 3 * 60 * 60; // 3 hours

let redis: Redis | null = null;
let warned = false;

function getRedis(): Redis | null {
  if (redis) return redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    if (!warned) {
      console.warn('[previewCache] Upstash env not set — guest cache disabled');
      warned = true;
    }
    return null;
  }
  redis = new Redis({ url, token });
  return redis;
}

export function normalizeGuestTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function guestPreviewCacheKey(topic: string): string {
  return `preview:guest:v1:${normalizeGuestTopic(topic).slice(0, 200)}`;
}

function parseCached(raw: unknown): GuestPreviewCached | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<GuestPreviewCached>;
  if (typeof v.firstTweet !== 'string' || !v.firstTweet.trim()) return null;
  if (typeof v.totalTweets !== 'number' || !Number.isFinite(v.totalTweets) || v.totalTweets < 1) {
    return null;
  }
  return { firstTweet: v.firstTweet, totalTweets: Math.floor(v.totalTweets) };
}

// Fail-open: a cache miss or a dead Redis must never block a guest who already
// passed the burst gate. The budget gate still bounds generation.
export async function getGuestPreviewCache(topic: string): Promise<GuestPreviewCached | null> {
  const r = getRedis();
  if (!r) return null;
  const key = guestPreviewCacheKey(topic);
  if (key.endsWith(':')) return null;
  try {
    return parseCached(await r.get(key));
  } catch (e) {
    console.error('[previewCache] get failed:', e instanceof Error ? e.message : e);
    return null;
  }
}

export async function setGuestPreviewCache(
  topic: string,
  value: GuestPreviewCached,
): Promise<void> {
  const parsed = parseCached(value);
  if (!parsed) return;
  const r = getRedis();
  if (!r) return;
  const ttl = Number(process.env.GUEST_PREVIEW_CACHE_TTL_SEC) || DEFAULT_TTL_SEC;
  try {
    await r.set(guestPreviewCacheKey(topic), parsed, { ex: ttl });
  } catch (e) {
    console.error('[previewCache] set failed:', e instanceof Error ? e.message : e);
  }
}
