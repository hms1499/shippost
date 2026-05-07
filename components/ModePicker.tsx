'use client';

import { GraduationCap, Flame } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CodexFrame } from './CodexFrame';

interface Props {
  onSelect: (mode: 'educational' | 'hot-take') => void;
}

interface Mode {
  id: 'educational' | 'hot-take';
  numeral: string;
  label: string;
  Icon: typeof GraduationCap;
  blurb: string;
  cost: string;
}

const MODES: Mode[] = [
  {
    id: 'educational',
    numeral: 'I',
    label: 'Educational Thread',
    Icon: GraduationCap,
    blurb: 'Explain one concept, end-to-end. e.g. "How EIP-712 typed signatures work".',
    cost: '$0.001 in x402',
  },
  {
    id: 'hot-take',
    numeral: 'II',
    label: 'Hot Take',
    Icon: Flame,
    blurb: 'React to news or a tweet with data. Search + market + fact-check inline.',
    cost: '$0.003 in x402',
  },
];

export function ModePicker({ onSelect }: Props) {
  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      <h2 className="heading-sub text-xs">De Modis Scribendi</h2>
      <p className="text-base italic text-muted-foreground -mt-2">
        Two ways to compose a thread. Choose your hand.
      </p>

      {MODES.map((m) => {
        const { Icon } = m;
        return (
          <Card
            key={m.id}
            ornament
            onClick={() => onSelect(m.id)}
            className="group p-5 cursor-pointer transition-[border-color,transform] duration-200 hover:border-[hsl(var(--ink-deep))] hover:-translate-y-0.5"
          >
            <div className="flex items-stretch gap-4">
              {/* Illuminated initial */}
              <div className="relative w-20 h-20 shrink-0 flex items-center justify-center text-primary">
                <CodexFrame
                  className="absolute inset-0 w-full h-full text-[hsl(var(--ink-faded))] opacity-70 group-hover:opacity-100 transition-opacity"
                />
                <span
                  className="relative font-serif italic font-semibold text-[2.6rem] leading-none select-none"
                  aria-hidden
                >
                  {m.numeral}
                </span>
                <Icon
                  size={14}
                  strokeWidth={1.4}
                  className="absolute bottom-1 right-1 text-[hsl(var(--ink-faded))] group-hover:text-primary transition-colors"
                  aria-hidden
                />
              </div>

              <div className="flex flex-col justify-between flex-1 min-w-0">
                <div>
                  <h3 className="font-serif text-xl font-semibold leading-tight">
                    {m.label}
                  </h3>
                  <p className="text-sm text-muted-foreground italic mt-1 leading-snug">
                    {m.blurb}
                  </p>
                </div>
                <p className="heading-sub text-[10px] mt-2">
                  $0.05 to start · {m.cost}
                </p>
              </div>
            </div>
          </Card>
        );
      })}
    </section>
  );
}
