'use client';

import { ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CodexFrame } from './CodexFrame';
import { IllumGraduationCap, IllumFlame, IllumCoin } from './IllumIcons';
import { InkText } from './InkText';
import { InkDivider } from './InkDivider';
import { Marginalia } from './Marginalia';

interface Props {
  onSelect: (mode: 'educational' | 'hot-take' | 'token-analysis') => void;
}

interface Mode {
  id: 'educational' | 'hot-take' | 'token-analysis';
  numeral: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
  blurb: string;
  cost: string;
  badge?: string;
}

const MODES: Mode[] = [
  {
    id: 'hot-take',
    numeral: 'I',
    label: 'Hot Take',
    Icon: IllumFlame,
    blurb: 'React to news or a tweet with data. Search + market + fact-check inline.',
    cost: '$0.003',
    badge: 'grounded · fact-checked · live data',
  },
  {
    id: 'educational',
    numeral: 'II',
    label: 'Educational Thread',
    Icon: IllumGraduationCap,
    blurb: 'Explain one concept, end-to-end. e.g. "How EIP-712 typed signatures work".',
    cost: '$0.001',
  },
  {
    id: 'token-analysis',
    numeral: 'III',
    label: 'Token Analysis',
    Icon: IllumCoin,
    blurb: 'Break down any token: price, mcap, catalysts. Live market data + fact-check inline.',
    cost: '$0.003',
    badge: 'grounded · live price · fact-checked',
  },
];

export function ModePicker({ onSelect }: Props) {
  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="heading-sub text-[10px]">Modes · Three styles</p>
        <InkText
          as="h2"
          className="font-display italic text-3xl leading-tight"
          delay={50}
        >
          Choose your hand
        </InkText>
        <p className="text-sm italic text-muted-foreground leading-snug">
          Pick a style — the agent writes the whole thread from there.
        </p>
      </div>

      <InkDivider />

      <div className="flex flex-col gap-3">
        {MODES.map((m, i) => {
          const { Icon } = m;
          return (
            <Card
              key={m.id}
              ornament
              onClick={() => onSelect(m.id)}
              className="group p-5 cursor-pointer transition-[border-color,transform] duration-200 hover:border-[hsl(var(--ink-deep))] hover:-translate-y-0.5"
              style={{
                animation: `mode-reveal 0.55s ${0.15 + i * 0.1}s cubic-bezier(.2,.6,.2,1) both`,
              }}
            >
              <div className="flex items-stretch gap-4">
                {/* Illuminated initial — kept iconic */}
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

                <div className="flex flex-col justify-between flex-1 min-w-0 gap-3">
                  <div>
                    <h3 className="font-display italic text-xl leading-tight">
                      {m.label}
                    </h3>
                    {m.badge && (
                      <span className="mt-1 inline-block rounded-full border border-[hsl(var(--ink-faded)/0.4)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[hsl(var(--ink-faded))]">
                        {m.badge}
                      </span>
                    )}
                    <p className="text-sm text-muted-foreground italic mt-1 leading-snug">
                      {m.blurb}
                    </p>
                  </div>

                  {/* Cost row — leader-dot rhythm matching the rest of the codex */}
                  <div className="flex items-baseline gap-2 text-[11px]">
                    <span className="italic text-muted-foreground">
                      $0.05 to begin
                    </span>
                    <span
                      aria-hidden
                      className="flex-1 border-b border-dotted border-[hsl(var(--ink-faded))] mb-1 opacity-50"
                    />
                    <span className="font-mono text-[hsl(var(--ink-faded))]">
                      {m.cost} x402
                    </span>
                  </div>
                </div>

                {/* Hover-revealed arrow — slides in from the right */}
                <ArrowRight
                  size={16}
                  aria-hidden
                  className="self-center shrink-0 text-[hsl(var(--ink-faded))] opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-primary transition-all duration-200"
                />
              </div>
            </Card>
          );
        })}
      </div>

      <Marginalia side="right" className="self-end mt-1">
        Any of the three, same $0.05 — the mode only changes the agent&apos;s recipe.
      </Marginalia>

      <style jsx>{`
        @keyframes mode-reveal {
          0% { opacity: 0; transform: translateY(12px); filter: blur(2px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
      `}</style>
    </section>
  );
}
