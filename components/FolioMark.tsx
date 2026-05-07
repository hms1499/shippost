import * as React from 'react';

/**
 * Page-corner annotation: tiny serif "fol. <numeral>" mark. Real codices
 * number folios in the upper right; we use this to ground the page in
 * manuscript context.
 */
export function FolioMark({ numeral }: { numeral: string }) {
  return (
    <span
      className="text-[10px] heading-sub leading-none select-none"
      aria-hidden
    >
      fol. {numeral}
    </span>
  );
}
