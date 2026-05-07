import * as React from 'react';

interface CodexFrameProps extends React.SVGProps<SVGSVGElement> {
  /** Whether to animate the stroke-draw on mount. */
  animated?: boolean;
}

/**
 * Decorative geometric construction lines — Vitruvian-style underlay. Sits
 * behind illuminated initials and hero blocks. Pure decoration; aria-hidden.
 *
 * Layers, faintest first:
 *   - inscribed square + its diagonals
 *   - outer + inner concentric circles
 *   - vesica piscis (two overlapping circles)
 *   - logarithmic golden spiral
 *   - corner ticks
 *
 * The lines fade outwards via a radial mask so the centre stays unobtrusive
 * behind whatever content sits on top.
 */
export function CodexFrame({ animated = false, className, ...rest }: CodexFrameProps) {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg
      viewBox="0 0 200 200"
      preserveAspectRatio="xMidYMid meet"
      className={`${animated ? 'ink-draw' : ''} ${className ?? ''}`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      style={{ ['--len' as string]: '1400' }}
      aria-hidden
      {...rest}
    >
      <defs>
        <radialGradient id={`fade-${id}`} cx="50%" cy="50%" r="55%">
          <stop offset="0%" stopColor="#000" stopOpacity="1" />
          <stop offset="100%" stopColor="#000" stopOpacity="0.18" />
        </radialGradient>
        <mask id={`mask-${id}`}>
          <rect width="200" height="200" fill={`url(#fade-${id})`} />
        </mask>
      </defs>

      <g mask={`url(#mask-${id})`} strokeWidth="0.5" opacity="0.85">
        {/* Outer + inner circles */}
        <circle cx="100" cy="100" r="78" />
        <circle cx="100" cy="100" r="58" />

        {/* Inscribed square + diagonals + axes */}
        <rect x="22" y="22" width="156" height="156" />
        <line x1="22" y1="22" x2="178" y2="178" />
        <line x1="178" y1="22" x2="22" y2="178" />
        <line x1="100" y1="0" x2="100" y2="200" />
        <line x1="0" y1="100" x2="200" y2="100" />

        {/* Vesica piscis — two intersecting circles on the horizontal axis */}
        <circle cx="76" cy="100" r="46" opacity="0.55" />
        <circle cx="124" cy="100" r="46" opacity="0.55" />

        {/* Logarithmic golden spiral approximated with quarter-circle arcs.
            Anchored top-left and curling clockwise inward. The radii follow
            the Fibonacci sequence scaled to fit the inscribed square. */}
        <path
          d="
            M 22 100
            A 78 78 0 0 1 100 22
            A 48 48 0 0 1 148 70
            A 30 30 0 0 1 118 100
            A 18 18 0 0 1 100 82
            A 12 12 0 0 1 112 70
          "
          opacity="0.7"
        />

        {/* Corner ticks */}
        <polyline points="16,22 22,22 22,16" />
        <polyline points="184,22 178,22 178,16" />
        <polyline points="16,178 22,178 22,184" />
        <polyline points="184,178 178,178 178,184" />
      </g>
    </svg>
  );
}
