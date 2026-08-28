/**
 * The two palettes, and the pure logic for choosing between them.
 *
 * Lives in lib/ rather than beside the toggle component on purpose: `test:lib`
 * runs `vitest run lib app`, so anything under components/ is never executed by
 * the suite and this repo has no component-render harness.
 */
export type Theme = 'terminal' | 'paper';

/**
 * Duplicated verbatim inside the inline <head> script in app/layout.tsx, which
 * runs before any module loads and therefore cannot import this file. The test
 * pins both values so the two copies cannot drift apart in silence.
 */
export const THEME_STORAGE_KEY = 'coinop-theme';
export const PAPER_CLASS = 'theme-paper';

/**
 * The <meta name="theme-color"> content per theme. Must equal that palette's
 * --background, or the phone's status bar sits in the other theme; the
 * contrast test asserts the match against app/globals.css.
 */
export const THEME_COLOR: Record<Theme, string> = {
  terminal: '#0A0D0A',
  paper: '#F2F0E6',
};

/**
 * Terminal is the answer to every question this cannot parse. The brand's own
 * surface is what a stranger should meet; Paper is only ever reached by an
 * explicit, exact opt-in.
 */
export function resolveTheme(stored: string | null | undefined): Theme {
  return stored === 'paper' ? 'paper' : 'terminal';
}

export function nextTheme(current: Theme): Theme {
  return current === 'terminal' ? 'paper' : 'terminal';
}
