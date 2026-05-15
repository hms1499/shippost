'use client';

import type { ReactNode } from 'react';
import { motion, useReducedMotion, type Variants } from 'framer-motion';

/**
 * Wraps one workflow screen so AnimatePresence can cross-fade between them.
 * Keep it keyed by the screen id in the parent. Respects the OS reduce-motion
 * setting: when set, it renders a plain opacity swap with no transform.
 */
export function ScreenTransition({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();

  const variants: Variants = reduce
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -8 },
      };

  return (
    <motion.div
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: reduce ? 0.12 : 0.28, ease: 'easeOut' as const }}
      className="w-full flex flex-col items-center gap-6"
    >
      {children}
    </motion.div>
  );
}
