import * as React from 'react';

/** Bordered surface panel with a `── TITLE ──` header row. */
export function TerminalPanel({
  title,
  children,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-border bg-card p-4 ${className ?? ''}`}
    >
      {title && (
        <div className="flex items-center gap-2 mb-3" aria-hidden>
          <span className="h-px w-4 bg-border" />
          <span className="heading-sub text-[10px]">{title}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      )}
      {children}
    </section>
  );
}
