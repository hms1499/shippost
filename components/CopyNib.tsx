'use client';

import { Check, Copy } from 'lucide-react';
import { useCopy } from '@/lib/useCopy';

/**
 * Small mono copy control for a single tweet. Sized to the same 36px hit area
 * as the ThreadPreview edit/reorder nibs so a cluster of them stays even under
 * a thumb. A blocked clipboard shows as 'blocked' rather than silently doing
 * nothing (see lib/useCopy).
 */
export function CopyNib({
  text,
  label = 'Copy tweet',
  className = '',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const { copied, failed, copy } = useCopy();
  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      aria-label={label}
      title={failed ? 'Clipboard blocked — long-press the text to copy manually' : label}
      className={
        'inline-flex shrink-0 items-center gap-1 h-9 px-2 rounded font-mono text-[11px] no-underline transition-colors ' +
        (failed
          ? 'text-destructive '
          : copied
            ? 'text-primary '
            : 'text-muted-foreground hover:text-primary active:bg-primary/10 ') +
        className
      }
    >
      {copied ? (
        <>
          <Check size={11} aria-hidden />
          copied
        </>
      ) : failed ? (
        'blocked'
      ) : (
        <>
          <Copy size={11} aria-hidden />
          copy
        </>
      )}
    </button>
  );
}
