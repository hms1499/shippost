import { describe, it, expect } from 'vitest';
import {
  THEME_STORAGE_KEY,
  PAPER_CLASS,
  THEME_COLOR,
  resolveTheme,
  nextTheme,
} from './theme';

describe('resolveTheme', () => {
  // Terminal is the default for everything unrecognised. A first-time
  // visitor, a cleared browser, a value written by an older build, or a
  // string typed into devtools must all land on the brand's own surface.
  it('falls back to terminal for anything that is not exactly "paper"', () => {
    for (const stored of [null, undefined, '', 'dark', 'light', 'PAPER', 'Paper', '{}']) {
      expect(resolveTheme(stored)).toBe('terminal');
    }
  });

  it('opts in on the exact string "paper"', () => {
    expect(resolveTheme('paper')).toBe('paper');
  });
});

describe('nextTheme', () => {
  it('toggles between the two themes', () => {
    expect(nextTheme('terminal')).toBe('paper');
    expect(nextTheme('paper')).toBe('terminal');
  });

  it('round-trips', () => {
    expect(nextTheme(nextTheme('terminal'))).toBe('terminal');
  });
});

describe('constants', () => {
  it('names a theme-color for both themes', () => {
    expect(THEME_COLOR.terminal).toMatch(/^#[0-9A-F]{6}$/i);
    expect(THEME_COLOR.paper).toMatch(/^#[0-9A-F]{6}$/i);
    expect(THEME_COLOR.terminal).not.toBe(THEME_COLOR.paper);
  });

  // The storage key and class name are baked into the inline <head> script in
  // app/layout.tsx, which cannot import this module. Changing either here
  // without changing that script silently breaks theme restoration, so pin
  // both values.
  it('pins the values the inline script duplicates', () => {
    expect(THEME_STORAGE_KEY).toBe('coinop-theme');
    expect(PAPER_CLASS).toBe('theme-paper');
  });
});
