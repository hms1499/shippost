import * as React from 'react';

/** 1px terminal rule; optional centered uppercase mono label. */
export function RuleDivider({ label, className }: { label?: string; className?: string }) {
  if (!label) {
    return <div className={`h-px bg-border ${className ?? ''}`} aria-hidden />;
  }
  return (
    <div className={`flex items-center gap-3 ${className ?? ''}`} aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="heading-sub text-[10px]">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
