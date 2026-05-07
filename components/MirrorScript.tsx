import * as React from 'react';

/**
 * Da Vinci famously wrote in mirror script. We render a tiny mirrored copy of
 * a phrase as a marginal Easter egg — visible on close inspection, invisible
 * to a glance. Inherits font + color, just flipped horizontally.
 */
export function MirrorScript({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={className}
      style={{ display: 'inline-block', transform: 'scaleX(-1)' }}
      aria-hidden
    >
      {children}
    </span>
  );
}
