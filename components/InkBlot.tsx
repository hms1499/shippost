import * as React from 'react';

interface BlotProps extends React.SVGProps<SVGSVGElement> {
  /** rotational + size variation; values 0-3 produce different shapes */
  variant?: 0 | 1 | 2;
  size?: number;
}

/**
 * Decorative ink stain — a small irregular blob with one or two satellite
 * droplets. Used as a far-left or far-right scatter accent on the page so the
 * parchment feels lived-in rather than templated. aria-hidden, decorative.
 */
export function InkBlot({ variant = 0, size = 24, className, ...rest }: BlotProps) {
  const paths: Record<0 | 1 | 2, React.ReactNode> = {
    0: (
      <>
        <path d="M6 12 q-3 -1 -3 -4 q0 -3 4 -4 q4 0 5 3 q3 -1 5 1 q3 2 0 5 q1 3 -2 4 q-3 1 -5 -1 q-2 1 -4 -4 Z" />
        <circle cx="20" cy="6" r="0.9" />
      </>
    ),
    1: (
      <>
        <path d="M4 8 q0 -3 3 -3 q3 0 4 2 q4 -1 6 1 q3 2 1 5 q1 2 -2 3 q-4 1 -7 -1 q-3 0 -5 -3 q-1 -2 0 -4 Z" />
        <circle cx="3" cy="14" r="0.7" />
        <circle cx="22" cy="11" r="0.6" />
      </>
    ),
    2: (
      <>
        <path d="M8 4 q4 -1 6 1 q3 0 4 3 q1 3 -2 4 q1 3 -3 4 q-4 1 -6 -2 q-3 -1 -3 -4 q0 -4 4 -6 Z" />
        <circle cx="18" cy="14" r="0.8" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 18"
      width={size}
      height={size * (18 / 24)}
      className={className}
      fill="currentColor"
      aria-hidden
      {...rest}
    >
      {paths[variant]}
    </svg>
  );
}
