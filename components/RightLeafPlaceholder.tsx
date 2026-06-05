'use client';

/**
 * Fills the right page of the desktop folio spread while the user is still on
 * an INPUT screen, so the spread is never lopsided. Decorative only; parchment
 * aesthetic (faint folio numeral + an italic invitation line).
 */
export function RightLeafPlaceholder() {
  return (
    <div className="w-full max-w-md min-h-[20rem] flex flex-col items-center justify-center gap-4 text-center select-none">
      <span
        aria-hidden
        className="font-display italic text-[7rem] leading-none text-[hsl(var(--ink-faded))] opacity-[0.15]"
      >
        0
      </span>
      <p className="font-display italic text-base text-muted-foreground max-w-[15rem] leading-snug">
        The right leaf awaits ink — compose on the left, and the agent fills this
        page.
      </p>
    </div>
  );
}
