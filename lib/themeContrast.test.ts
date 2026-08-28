import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { THEME_COLOR } from './theme';

/**
 * The palettes are CSS custom properties, so this reads app/globals.css as the
 * single source rather than keeping a second copy of the values in TypeScript
 * that could drift. It is the test that lets a light theme ship at all: without
 * it "the light theme is readable" would be a claim rather than a property, and
 * it guards the dark palette from drift at the same time.
 */
type Hsl = [number, number, number];

const CSS = readFileSync(join(process.cwd(), 'app/globals.css'), 'utf8');

function ruleBody(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  if (at === -1) throw new Error(`no "${selector}" rule in app/globals.css`);
  const end = CSS.indexOf('\n  }', at);
  if (end === -1) throw new Error(`unterminated "${selector}" rule`);
  return CSS.slice(at, end);
}

function tokensOf(selector: string): Record<string, Hsl> {
  const out: Record<string, Hsl> = {};
  for (const m of ruleBody(selector).matchAll(
    /--([a-z-]+):\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/g,
  )) {
    out[m[1]] = [Number(m[2]), Number(m[3]) / 100, Number(m[4]) / 100];
  }
  return out;
}

function backgroundHex(selector: string): string {
  const m = ruleBody(selector).match(/--background:[^;]+;\s*\/\*\s*(#[0-9A-Fa-f]{6})/);
  if (!m) throw new Error(`"${selector}" has no --background hex comment`);
  return m[1].toUpperCase();
}

function relLuminance([h, s, l]: Hsl): number {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  const [r, g, b] = t.map((v) =>
    v + m <= 0.03928 ? (v + m) / 12.92 : ((v + m + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Hsl, b: Hsl): number {
  const [hi, lo] = [relLuminance(a), relLuminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
}

/** Every foreground token against every ground it is actually painted on. */
const PAIRS: [string, string][] = [
  ['foreground', 'background'],
  ['foreground', 'card'],
  ['card-foreground', 'card'],
  ['primary', 'background'],
  ['primary', 'card'],
  ['primary', 'secondary'],
  ['money', 'background'],
  ['money', 'card'],
  ['money', 'secondary'],
  ['destructive', 'background'],
  ['destructive', 'card'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'card'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'secondary'],
  ['primary-foreground', 'primary'],
  ['destructive-foreground', 'destructive'],
  ['secondary-foreground', 'secondary'],
  ['accent-foreground', 'accent'],
];

const PALETTES: [string, string][] = [
  ['Terminal', ':root'],
  ['Paper', 'html.theme-paper'],
];

describe.each(PALETTES)('%s palette', (_name, selector) => {
  const tokens = tokensOf(selector);

  it.each(PAIRS)('--%s on --%s clears WCAG AA (4.5:1)', (fg, bg) => {
    expect(tokens[fg], `--${fg} missing from ${selector}`).toBeDefined();
    expect(tokens[bg], `--${bg} missing from ${selector}`).toBeDefined();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('theme-color', () => {
  // A mismatch here paints the phone status bar in the other theme.
  it.each([
    ['terminal', ':root'],
    ['paper', 'html.theme-paper'],
  ] as const)('matches the %s background', (theme, selector) => {
    expect(backgroundHex(selector)).toBe(THEME_COLOR[theme].toUpperCase());
  });
});
