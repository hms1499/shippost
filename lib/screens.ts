// Screen name union and input/output categorisation for the folio-spread layout.

export type Screen =
  | 'mode'
  | 'educational'
  | 'hot-take'
  | 'news-breakdown'
  | 'token-analysis'
  | 'daily-recap'
  | 'comparison'
  | 'preview-locked'
  // Preview came back empty (rate limit, outage, budget). We stop here and ask
  // rather than charging: the input screen promises the preview is free, and a
  // silent fall-through to pay would break that promise. See HomeClient.beginFlow.
  | 'preview-unavailable'
  // Preflight says the agent cannot settle an x402 call right now (paused, out
  // of gas, or out of daily cap). We stop before payForThread is signed, so no
  // money moves and no thread row exists. See HomeClient.unlock.
  | 'spend-unavailable'
  // The client lost its screen mid-run (reload, back gesture, webview reclaimed)
  // and found a paid run in storage. Read-only: it polls the thread row and
  // never re-issues /api/generate/stream, which would be rejected 409 anyway.
  | 'resuming'
  | 'generating'
  | 'preview'
  | 'post-share';

const INPUT_SCREENS: readonly Screen[] = ['mode', 'educational', 'hot-take', 'news-breakdown', 'token-analysis', 'daily-recap', 'comparison'];

export function isInputScreen(screen: Screen): boolean {
  return INPUT_SCREENS.includes(screen);
}

export function isOutputScreen(screen: Screen): boolean {
  return !isInputScreen(screen);
}
