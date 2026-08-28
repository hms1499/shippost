'use client';

import { useEffect, useState } from 'react';
import { counterCells } from '@/lib/counterCells';

/**
 * A figure rendered as a mechanical counter: every digit sits in its own cell,
 * the way the coin counter inside an arcade cabinet or a vending machine reads.
 * Separators ($ , .) stay loose between the cells so the number still reads as
 * money rather than as a row of boxes.
 *
 * The counter is the artifact that proves a machine has been used, which is the
 * one thing a stranger on this page needs to believe. It is live — the strip
 * polls every 30s — so the roll has to fire on an increment, not only on load;
 * see lib/counterCells.ts for the keying that makes that happen.
 */

// 420ms roll + the longest stagger delay, i.e. when the initial settle is over.
const SETTLE_MS = 800;

export function OperatorCounter({
  value,
  label,
  money,
}: {
  value: string;
  label: string;
  money?: boolean;
}) {
  const cells = counterCells(value);

  // The stagger is the wheel settling on first paint. A later increment is one
  // digit turning over, and making it wait its turn in a left-to-right cascade
  // reads as lag — the cents digit of a wide figure would sit still for 360ms
  // before moving. So the delay is dropped once the initial settle is done.
  //
  // Flipped on a timer rather than in a mount effect: changing animation-delay
  // on a span that is still mid-roll would disturb the animation it is there
  // to produce. By SETTLE_MS nothing is in flight.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className={`flex items-center gap-[0.12em] font-mono font-bold tabular-nums leading-none text-[clamp(1.35rem,4.2vw,2.25rem)] ${
          money ? 'text-money' : 'text-foreground'
        }`}
        // The cells are a drawing of the number; assistive tech gets it whole.
        role="img"
        aria-label={`${value} ${label}`}
      >
        {cells.map((c, i) =>
          c.isDigit ? (
            <span key={c.key} className="digit-cell">
              <span style={{ animationDelay: settled ? '0ms' : `${i * 45}ms` }}>
                {c.char}
              </span>
            </span>
          ) : (
            <span key={c.key} aria-hidden className="px-[0.02em] opacity-80">
              {c.char}
            </span>
          ),
        )}
      </div>
      <p className="heading-sub text-[10px] leading-tight text-center">{label}</p>
    </div>
  );
}
