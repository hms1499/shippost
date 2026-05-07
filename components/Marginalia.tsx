import * as React from 'react';

interface MarginaliaProps {
  /** Where the leader line points to. */
  side?: 'left' | 'right';
  children: React.ReactNode;
  className?: string;
}

/**
 * Small italic note in the margin with a short ink leader line — like
 * marginalia in a manuscript. On narrow viewports it tucks under the content
 * since real margins disappear; on wider screens it sits to the side.
 */
export function Marginalia({ side = 'right', children, className }: MarginaliaProps) {
  return (
    <aside
      className={
        'flex items-start gap-2 text-[11px] italic text-[hsl(var(--ink-faded))] ' +
        (side === 'right' ? 'flex-row-reverse text-right' : 'text-left') +
        ' ' +
        (className ?? '')
      }
    >
      <svg
        width="18"
        height="8"
        viewBox="0 0 18 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="0.6"
        strokeLinecap="round"
        className="mt-1.5 shrink-0"
        style={{ transform: side === 'right' ? 'scaleX(-1)' : undefined }}
        aria-hidden
      >
        <path d="M1 4 L13 4" strokeDasharray="1.5 1" />
        <circle cx="15" cy="4" r="0.7" fill="currentColor" />
      </svg>
      <span className="leading-snug">{children}</span>
    </aside>
  );
}
