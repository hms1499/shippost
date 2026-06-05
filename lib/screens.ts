export type Screen =
  | 'mode'
  | 'educational'
  | 'hot-take'
  | 'preview-locked'
  | 'generating'
  | 'preview'
  | 'post-share';

const INPUT_SCREENS = ['mode', 'educational', 'hot-take'] as const;

export function isInputScreen(screen: Screen): boolean {
  return (INPUT_SCREENS as readonly string[]).includes(screen);
}

export function isOutputScreen(screen: Screen): boolean {
  return !isInputScreen(screen);
}
