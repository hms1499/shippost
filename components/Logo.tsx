import * as React from 'react';

interface LogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * Inline SVG logo — a stylised winged arm offering a small parcel, framed by
 * the codex circle/square construction lines. Strokes use currentColor so it
 * adapts to whichever theme the host paints (sepia ink on parchment / pale
 * blue on slate).
 */
export function Logo({ size = 56, className, ...rest }: LogoProps) {
  return (
    <svg
      viewBox="0 0 80 80"
      width={size}
      height={size}
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {/* Construction frame — circle inscribed in square, faint */}
      <g opacity="0.45" strokeWidth="0.5">
        <circle cx="40" cy="40" r="33" />
        <rect x="13" y="13" width="54" height="54" />
        <line x1="13" y1="13" x2="67" y2="67" />
        <line x1="67" y1="13" x2="13" y2="67" />
        <line x1="40" y1="7" x2="40" y2="73" />
        <line x1="7" y1="40" x2="73" y2="40" />
      </g>

      {/* Wing — three arched feathers stacked, sweeping back */}
      <g strokeWidth="1.1">
        <path d="M22 36 q-4 -8 -2 -16 q4 4 8 14" />
        <path d="M26 40 q-4 -10 0 -18 q5 6 10 14" />
        <path d="M30 44 q-2 -8 4 -14 q6 6 10 12" />
        {/* arm */}
        <path d="M28 42 q8 6 18 6 q4 0 8 -1" />
        {/* hand cradling box */}
        <path d="M48 47 q3 -1 6 -1" />
      </g>

      {/* Gift parcel — small cube with bow */}
      <g strokeWidth="1.1">
        <path d="M52 38 l9 4 l0 9 l-9 4 l-9 -4 l0 -9 z" />
        <path d="M52 38 l9 4 m-9 -4 l-9 4 m9 0 l0 13" />
        {/* bow */}
        <path d="M50 36 q1 -3 3 -2 q1 -2 3 0 q2 -1 2 2" strokeWidth="0.9" />
      </g>
    </svg>
  );
}
