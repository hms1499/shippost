'use client';

import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import {
  type Theme,
  THEME_STORAGE_KEY,
  PAPER_CLASS,
  THEME_COLOR,
  nextTheme,
} from '@/lib/theme';

/**
 * Switches between the Terminal and Paper palettes.
 *
 * The class on <html> is already correct before this mounts (the pre-paint
 * script in app/layout.tsx), so this reads the DOM rather than storage for its
 * initial state — one source of truth, and no chance of rendering a control
 * that disagrees with the page behind it.
 *
 * 36x36, the repo's nib size (see CopyNib.tsx and a dozen siblings).
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('terminal');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(
      document.documentElement.classList.contains(PAPER_CLASS) ? 'paper' : 'terminal',
    );
    setMounted(true);
  }, []);

  function toggle() {
    const to = nextTheme(theme);
    document.documentElement.classList.toggle(PAPER_CLASS, to === 'paper');
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLOR[to]);
    // A blocked or full localStorage must not break the switch itself; the
    // theme still applies, it just will not survive a reload.
    try {
      localStorage.setItem(THEME_STORAGE_KEY, to);
    } catch {
      /* private mode — accept the loss of persistence */
    }
    setTheme(to);
  }

  // Server and first client render must agree, and the server cannot know the
  // stored choice. Render the frame at its final size so the header does not
  // reflow when the icon arrives.
  const actionLabel =
    theme === 'paper' ? 'Switch to the dark Terminal theme' : 'Switch to the light Paper theme';

  return (
    <button
      type="button"
      onClick={toggle}
      // The accessible name names the STATE ("Paper theme"), not the action —
      // matching aria-pressed's existing convention elsewhere in the repo
      // (EducationalInput.tsx, HotTakeInput.tsx, TokenAnalysisInput.tsx all
      // pair aria-pressed with a state/option name, never an action sentence).
      // A flipping action string here would make a screen reader announce
      // "Switch to the dark Terminal theme, pressed" — self-contradictory.
      // `title` stays the flipping action phrasing since it does not enter
      // the accessible name once aria-label is present.
      aria-label="Paper theme"
      aria-pressed={theme === 'paper'}
      title={actionLabel}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-primary active:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {mounted ? (
        theme === 'paper' ? (
          <Moon size={15} aria-hidden />
        ) : (
          <Sun size={15} aria-hidden />
        )
      ) : null}
    </button>
  );
}
