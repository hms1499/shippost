import * as React from 'react';

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number };

const baseProps = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  strokeWidth: 1.1,
};

/**
 * Hand-drawn illuminated icons. Slightly off-grid stroke work, sparse hatching
 * lines, and an ink-blot accent point — meant to read as marginal sketches in
 * a codex rather than UI glyphs. Pair with `.lucide` siblings; these stay at
 * stroke-width 1.1 to feel quill-thin.
 */

function Wrap({ size = 28, children, className, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className={className}
      aria-hidden
      {...baseProps}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Scholar's mortarboard with a floating quill and a small ink dot. */
export function IllumGraduationCap(props: IconProps) {
  return (
    <Wrap {...props}>
      {/* board */}
      <path d="M4 14 L16 9 L28 14 L16 19 Z" />
      {/* base / cap rim */}
      <path d="M9 17 L9 22 q0 2 7 2 q7 0 7 -2 L23 17" />
      {/* tassel */}
      <path d="M28 14 L28 21" />
      <circle cx="28" cy="22" r="0.8" fill="currentColor" />
      {/* feather quill across upper right */}
      <path d="M22 8 q3 -3 6 -2 q-1 3 -4 6" strokeWidth="0.9" />
      <path d="M24 9 l1 1 m1 -3 l1 1 m1 -3 l1 1" strokeWidth="0.7" />
      {/* tiny ink hatching */}
      <path d="M6 22 L8 22 M5 24 L7 24" strokeWidth="0.7" opacity="0.55" />
    </Wrap>
  );
}

/** Single flame above a rimmed lamp dish. */
export function IllumFlame(props: IconProps) {
  return (
    <Wrap {...props}>
      {/* flame */}
      <path d="M16 5 q-2 4 -2 7 q0 3 2 5 q2 -2 2 -5 q0 -3 -2 -7 Z" />
      {/* inner ember */}
      <path d="M16 10 q-1 2 -1 4 q0 1.5 1 2.5 q1 -1 1 -2.5 q0 -2 -1 -4" strokeWidth="0.7" opacity="0.6" />
      {/* lamp dish */}
      <path d="M9 21 q0 -2 7 -2 q7 0 7 2 q0 3 -7 3 q-7 0 -7 -3 Z" />
      {/* lamp base */}
      <path d="M11 24 L11 27 q0 1 5 1 q5 0 5 -1 L21 24" />
      {/* hatching under lamp */}
      <path d="M5 28 L9 28 M22 28 L27 28" strokeWidth="0.7" opacity="0.5" />
    </Wrap>
  );
}

/** Quill pen resting on an inkwell with a single ink drop. */
export function IllumQuill(props: IconProps) {
  return (
    <Wrap {...props}>
      {/* inkwell base */}
      <path d="M5 23 q0 -3 6 -3 q6 0 6 3 L17 27 q0 1 -6 1 q-6 0 -6 -1 Z" />
      <path d="M5 23 q0 1 6 1 q6 0 6 -1" strokeWidth="0.8" opacity="0.6" />
      {/* quill shaft */}
      <path d="M11 22 L26 7" />
      {/* feather barbs */}
      <path d="M22 11 q3 0 4 -3 M20 13 q3 0 4 -3 M18 15 q3 0 4 -3" strokeWidth="0.7" />
      {/* nib tip */}
      <path d="M10 22 L13 21" strokeWidth="0.9" />
      {/* ink drop */}
      <circle cx="9" cy="26" r="0.6" fill="currentColor" />
    </Wrap>
  );
}

/** Coin with a hand-drawn rising chart line and an ink dot. */
export function IllumCoin(props: IconProps) {
  return (
    <Wrap {...props}>
      {/* coin rim */}
      <circle cx="16" cy="16" r="11" />
      {/* inner rule */}
      <circle cx="16" cy="16" r="8.5" strokeWidth="0.6" opacity="0.5" />
      {/* rising chart line across the face */}
      <path d="M10 19 L14 15 L18 17 L22 11" strokeWidth="1.3" />
      {/* arrow head on the climb */}
      <path d="M22 11 L19.5 11 M22 11 L22 13.5" strokeWidth="0.9" />
      {/* tiny ink hatching at the base */}
      <path d="M11 24 L13 24 M19 24 L21 24" strokeWidth="0.7" opacity="0.5" />
      {/* ink dot */}
      <circle cx="10" cy="19" r="0.7" fill="currentColor" />
    </Wrap>
  );
}

/** Heraldic shield with a hand-drawn check inside. */
export function IllumShield(props: IconProps) {
  return (
    <Wrap {...props}>
      {/* shield outline */}
      <path d="M16 4 q-7 1.5 -10 3 q0 11 5 17 q3 4 5 4 q2 0 5 -4 q5 -6 5 -17 q-3 -1.5 -10 -3 Z" />
      {/* inner rule */}
      <path d="M16 7 q-5 1 -8 2 q0 9 4 14 q2 3 4 3 q2 0 4 -3 q4 -5 4 -14 q-3 -1 -8 -2 Z" strokeWidth="0.6" opacity="0.5" />
      {/* check */}
      <path d="M10.5 16 L14 19.5 L21 12.5" strokeWidth="1.4" />
    </Wrap>
  );
}
