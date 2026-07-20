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
