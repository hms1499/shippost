export interface PreviewHealth {
  ok: boolean;
  reason?: string;
}

// A neutral, evergreen topic: the probe must not depend on the news cycle, or a
// quiet news day would look like an outage.
const SYNTHETIC_TOPIC = 'what is a stablecoin';
const PROBE_TIMEOUT_MS = 30_000;

// Synthetic probe for the free preview — the landing's only conversion path.
//
// It goes over HTTP against the real app on purpose. Calling runPreview()
// in-process would exercise the generator but skip the rate-limit gate, and the
// gate is precisely what broke in prod: with Upstash env missing it failed
// CLOSED and answered {available:false} with HTTP 200 — a valid-looking
// response, not an error — so the preview was dead for days and nothing paged.
// This probe walks the whole path a real visitor walks: gate -> Redis -> Serper
// -> Groq -> tweets.
//
// Costs one preview against the daily budget (default 500), so a daily cron is
// free in practice. Note {available:false} also means "global budget genuinely
// exhausted" — with real traffic that would be a happy problem, and it is still
// worth knowing, so we report it either way rather than trying to tell the two
// apart from the outside.
export async function checkPreviewAlive(baseUrl: string): Promise<PreviewHealth> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api/preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Guest shape: mode 0 with no walletAddress — the pre-connect landing taste.
      body: JSON.stringify({ mode: 0, topic: SYNTHETIC_TOPIC }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }

  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

  let body: { available?: boolean; firstTweet?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch {
    return { ok: false, reason: 'response was not JSON' };
  }

  if (body.available === false) {
    return {
      ok: false,
      reason: 'gate denied (available:false) — limiter unreachable or daily budget exhausted',
    };
  }
  if (typeof body.firstTweet !== 'string' || !body.firstTweet.trim()) {
    return { ok: false, reason: 'no tweet in response' };
  }
  return { ok: true };
}
