'use client';

import { Card } from '@/components/ui/card';
import { CodexFrame } from './CodexFrame';
import { IllumGraduationCap, IllumFlame } from './IllumIcons';
import { InkText } from './InkText';

interface Props {
  onSelect: (mode: 'educational' | 'hot-take') => void;
}

interface Mode {
  id: 'educational' | 'hot-take';
  numeral: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  blurb: string;
  cost: string;
}

const MODES: Mode[] = [
  {
    id: 'educational',
    numeral: 'I',
    label: 'Educational Thread',
    Icon: IllumGraduationCap,
    blurb: 'Explain one concept, end-to-end. e.g. "How EIP-712 typed signatures work".',
    cost: '$0.001 in x402',
  },
  {
    id: 'hot-take',
    numeral: 'II',
    label: 'Hot Take',
    Icon: IllumFlame,
    blurb: 'React to news or a tweet with data. Search + market + fact-check inline.',
    cost: '$0.003 in x402',
  },
];

export function ModePicker({ onSelect }: Props) {
  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      <h2 className="heading-sub text-xs">De Modis Scribendi</h2>
      <InkText
        as="p"
        className="text-base italic text-muted-foreground -mt-2 leading-relaxed"
        delay={16}
      >
        Two ways to compose a thread. Choose your hand — the agent will pick up the quill and finish the rest.
      </InkText>

      {MODES.map((m, i) => {
        const { Icon } = m;
        return (
          <Card
            key={m.id}
            ornament
            onClick={() => onSelect(m.id)}
            className="group p-5 cursor-pointer transition-[border-color,transform] duration-200 hover:border-[hsl(var(--ink-deep))] hover:-translate-y-0.5"
            style={{
              animation: `fade-up 0.5s ${i * 0.12}s cubic-bezier(.2,.6,.2,1) both`,
            }}
          >
            <div className="flex items-stretch gap-4">
              {/* Illuminated initial */}
              <div className="relative w-24 h-24 shrink-0 flex items-center justify-center text-primary">
                <CodexFrame
                  animated
                  className="absolute inset-0 w-full h-full text-[hsl(var(--ink-faded))] opacity-70 group-hover:opacity-100 transition-opacity"
                />
                <span
                  className="relative font-display italic text-[3.6rem] leading-none select-none"
                  aria-hidden
                >
                  {m.numeral}
                </span>
                <Icon
                  size={20}
                  className="absolute bottom-1 right-1 text-[hsl(var(--ink-faded))] group-hover:text-primary transition-colors"
                />
              </div>

              <div className="flex flex-col justify-between flex-1 min-w-0">
                <div>
                  <h3 className="font-display text-xl leading-tight">
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
      <style jsx>{`
        @keyframes fade-up {
          0% { opacity: 0; transform: translateY(12px); filter: blur(2px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
      `}</style>
    </section>
  );
}
