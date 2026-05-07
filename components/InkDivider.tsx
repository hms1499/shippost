import * as React from 'react';

/**
 * Renaissance-style horizontal rule with a small lozenge ornament at the
 * centre. Rules taper towards the ornament so the eye is drawn to it.
 */
export function InkDivider({ className }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-3 text-[hsl(var(--ink-faded))] ${className ?? ''}`}
      aria-hidden
    >
      <span className="h-px flex-1 bg-gradient-to-r from-transparent to-current opacity-60" />
      <svg width="14" height="10" viewBox="0 0 14 10" fill="none">
        <path
          d="M1 5 L7 1 L13 5 L7 9 Z"
          stroke="currentColor"
          strokeWidth="0.8"
          strokeLinejoin="round"
        />
        <circle cx="7" cy="5" r="0.8" fill="currentColor" />
      </svg>
      <span className="h-px flex-1 bg-gradient-to-l from-transparent to-current opacity-60" />
    </div>
  );
}
