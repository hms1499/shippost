// Screen name union and input/output categorisation for the folio-spread layout.

export type Screen =
  | 'mode'
  | 'educational'
  | 'hot-take'
  | 'token-analysis'
  | 'daily-recap'
  | 'preview-locked'
  | 'generating'
  | 'preview'
  | 'post-share';

const INPUT_SCREENS: readonly Screen[] = ['mode', 'educational', 'hot-take', 'token-analysis', 'daily-recap'];

export function isInputScreen(screen: Screen): boolean {
  return INPUT_SCREENS.includes(screen);
}

export function isOutputScreen(screen: Screen): boolean {
  return !isInputScreen(screen);
}
