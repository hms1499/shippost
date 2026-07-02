import * as React from 'react';

/**
 * Dim mono annotation rendered beside a step or field, offset to one side.
 */
export function TraceNote({
  side = 'right',
  children,
  className,
}: {
  side?: 'left' | 'right';
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={
        'text-[11px] font-mono text-muted-foreground leading-snug ' +
        (side === 'right' ? 'text-right' : 'text-left') +
        ' ' +
        (className ?? '')
      }
    >
      <span className="text-primary/60 select-none">{side === 'left' ? '// ' : ''}</span>
      {children}
      <span className="text-primary/60 select-none">{side === 'right' ? ' //' : ''}</span>
    </aside>
  );
}
