'use client';

import type { ReactNode } from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from 'framer-motion';

interface FolioSpreadProps {
  leftKey: string;
  rightKey: string;
  left: ReactNode;
  right: ReactNode;
}

/**
 * Desktop-only open-codex layout. Two parchment leaves bound at a central
 * gutter — the signature is the binding itself: a valley shadow at the fold,
 * a crease catching light, and faint stitches running down the spine. Each
 * leaf is lifted off the desk (drop shadow), carries its own grain + a margin
 * rule, and is labelled verso / recto like a real opening. On every state
 * change the incoming leaf turns on a hinge anchored at the spine.
 *
 * API is intentionally identical to the plain version: { leftKey, rightKey,
 * left, right } — so the HomeClient wiring is unchanged.
 */
export function FolioSpread({ leftKey, rightKey, left, right }: FolioSpreadProps) {
  return (
    <div className="folio-perspective relative w-full max-w-4xl">
      <div className="book relative grid grid-cols-2 rounded-[3px]">
        <span aria-hidden className="grain" />
        <Leaf side="left" pageKey={leftKey} folio="verso">
          {left}
        </Leaf>
        <Leaf side="right" pageKey={rightKey} folio="recto">
          {right}
        </Leaf>
        {/* The binding — drawn above the leaves so the fold shadow falls onto
            the inner margins, the way light dies in the gutter of a real book. */}
        <span aria-hidden className="gutter" />
      </div>

      <style jsx>{`
        .folio-perspective {
          perspective: 2200px;
        }
        .book {
          background: hsl(var(--card));
          box-shadow:
            0 34px 72px -26px hsl(var(--ink-deep) / 0.42),
            0 12px 26px -14px hsl(var(--ink-deep) / 0.3),
            inset 0 0 78px -24px hsl(var(--ink-deep) / 0.2);
        }
        /* Fine parchment stippling, same recipe as the page <body> grain so the
           leaves read as the same stock. */
        .grain {
          position: absolute;
          inset: 0;
          z-index: 0;
          pointer-events: none;
          opacity: 0.5;
          mix-blend-mode: multiply;
          background-image: url("data:image/svg+xml;utf8,<svg viewBox='0 0 220 220' xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.32  0 0 0 0 0.22  0 0 0 0 0.12  0 0 0 0.18 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/></svg>");
          background-size: 240px 240px;
        }
        /* The valley shadow of the fold — the two page surfaces curving down
           into the binding. Darkest right at the crease, easing out fast. */
        .gutter {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 116px;
          transform: translateX(-50%);
          z-index: 6;
          pointer-events: none;
          background: linear-gradient(
            to right,
            transparent 0%,
            hsl(var(--ink-deep) / 0.1) 30%,
            hsl(var(--ink-deep) / 0.34) 46%,
            hsl(var(--ink-deep) / 0.52) 50%,
            hsl(var(--ink-deep) / 0.34) 54%,
            hsl(var(--ink-deep) / 0.1) 70%,
            transparent 100%
          );
        }
        /* The crease itself, with a thread of card-coloured highlight either
           side so the paper looks like it catches light as it folds open. */
        .gutter::before {
          content: '';
          position: absolute;
          top: 0;
          bottom: 0;
          left: 50%;
          width: 2px;
          transform: translateX(-50%);
          background: linear-gradient(
            to bottom,
            transparent,
            hsl(var(--ink-deep) / 0.7) 10%,
            hsl(var(--ink-deep) / 0.7) 90%,
            transparent
          );
          box-shadow:
            2px 0 2px hsl(var(--card) / 0.85),
            -2px 0 2px hsl(var(--card) / 0.7);
        }
        /* Binding stitches down the spine. */
        .gutter::after {
          content: '';
          position: absolute;
          top: 7%;
          bottom: 7%;
          left: 50%;
          width: 1px;
          transform: translateX(-50%);
          background: repeating-linear-gradient(
            to bottom,
            hsl(var(--ink-faded) / 0.55) 0 7px,
            transparent 7px 19px
          );
        }
        @media (prefers-reduced-motion: reduce) {
          .book {
            box-shadow:
              0 20px 44px -24px hsl(var(--ink-deep) / 0.4),
              inset 0 0 60px -24px hsl(var(--ink-deep) / 0.18);
          }
        }
      `}</style>
    </div>
  );
}

function Leaf({
  side,
  pageKey,
  folio,
  children,
}: {
  side: 'left' | 'right';
  pageKey: string;
  folio: string;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const dir = side === 'left' ? 1 : -1;
  const hinge = side === 'left' ? 'right center' : 'left center';

  const variants: Variants = reduce
    ? {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
      }
    : {
        initial: { opacity: 0, rotateY: dir * -11, x: dir * 9 },
        animate: { opacity: 1, rotateY: 0, x: 0 },
        exit: { opacity: 0, rotateY: dir * 9, x: dir * -6 },
      };

  return (
    <div
      className={
        'relative z-[1] flex justify-center min-h-[26rem] py-12 ' +
        (side === 'left' ? 'pl-10 pr-14' : 'pr-10 pl-14')
      }
    >
      {/* Outer margin rule — the ruled boundary of the text block. */}
      <span
        aria-hidden
        className={
          'pointer-events-none absolute top-12 bottom-12 w-px bg-[hsl(var(--ink-faded)/0.18)] ' +
          (side === 'left' ? 'left-9' : 'right-9')
        }
      />

      <div className="w-full max-w-md">
        <AnimatePresence mode="wait">
          <motion.div
            key={pageKey}
            variants={variants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{
              duration: reduce ? 0.14 : 0.5,
              ease: [0.2, 0.6, 0.2, 1],
            }}
            style={{ transformOrigin: hinge }}
            className="w-full flex flex-col items-center gap-6"
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Folio label — verso (left) / recto (right), the way a real opening is
          named. */}
      <span
        aria-hidden
        className={
          'pointer-events-none absolute bottom-4 heading-sub text-[9px] italic text-[hsl(var(--ink-faded))] tracking-[0.22em] ' +
          (side === 'left' ? 'left-8' : 'right-8')
        }
      >
        {folio}
      </span>
    </div>
  );
}
