import * as React from 'react';

/**
 * 1px terminal rule; optional centered uppercase mono label.
 *
 * Full width by default. The bare rule is a div with a height and no width of
 * its own, so any parent that centres its children (`items-center`) shrank it
 * to nothing — which is how /history shipped with an invisible divider at every
 * screen size. Callers inside stretch containers are unaffected.
 */
export function RuleDivider({ label, className }: { label?: string; className?: string }) {
  if (!label) {
    return <div className={`w-full h-px bg-border ${className ?? ''}`} aria-hidden />;
  }
  return (
    <div className={`w-full flex items-center gap-3 ${className ?? ''}`} aria-hidden>
      <span className="h-px flex-1 bg-border" />
      <span className="heading-sub text-[10px]">{label}</span>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}
