import * as React from 'react';

/** Surface panel with a `── TITLE ──` header row. Framed by default;
 * `plain` drops the border/bg for de-boxed compose screens. */
export function TerminalPanel({
  title,
  children,
  className,
  variant = 'framed',
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  variant?: 'framed' | 'plain';
}) {
  const frame =
    variant === 'framed'
      ? 'rounded-lg border border-border bg-card p-5'
      : 'px-0 py-1';
  return (
    <section className={`${frame} ${className ?? ''}`}>
      {title && (
        <div className="flex items-center gap-2 mb-3">
          <span className="h-px w-4 bg-border" aria-hidden />
          <span className="heading-sub text-[10px]">{title}</span>
          <span className="h-px flex-1 bg-border" aria-hidden />
        </div>
      )}
      {children}
    </section>
  );
}
