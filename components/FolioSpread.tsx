'use client';

import type { ReactNode } from 'react';
import { AnimatePresence } from 'framer-motion';
import { ScreenTransition } from './motion/ScreenTransition';

interface FolioSpreadProps {
  leftKey: string;
  rightKey: string;
  left: ReactNode;
  right: ReactNode;
}

/**
 * Desktop-only open-codex layout: two ~max-w-md pages separated by a vertical
 * "spine" rule, centered within max-w-4xl. Each page cross-fades its own
 * content via an independent AnimatePresence keyed by leftKey/rightKey.
 */
export function FolioSpread({ leftKey, rightKey, left, right }: FolioSpreadProps) {
  return (
    <div className="w-full max-w-4xl grid grid-cols-2">
      <div className="pr-10 flex justify-end">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            <ScreenTransition key={leftKey}>{left}</ScreenTransition>
          </AnimatePresence>
        </div>
      </div>
      <div className="pl-10 border-l border-[hsl(var(--ink-faded)/0.4)] flex justify-start">
        <div className="w-full max-w-md">
          <AnimatePresence mode="wait">
            <ScreenTransition key={rightKey}>{right}</ScreenTransition>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
