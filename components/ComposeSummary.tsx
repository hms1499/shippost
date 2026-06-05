'use client';

import { Card } from '@/components/ui/card';
import { InkDivider } from './InkDivider';

interface ComposeSummaryProps {
  mode: 0 | 1;
  tokenSymbol: string;
  topic?: string;
  audience?: string;
  eventDescription?: string;
  angle?: string;
}

function cap(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Read-only "brief" shown on the left page of the desktop spread once the user
 * has submitted, replacing the input form so the left page is never empty.
 * Left = what you asked; the right page shows what the agent forged.
 */
export function ComposeSummary({
  mode,
  tokenSymbol,
  topic,
  audience,
  eventDescription,
  angle,
}: ComposeSummaryProps) {
  const numeral = mode === 0 ? 'II' : 'I';
  const label = mode === 0 ? 'Educational' : 'Hot Take';

  return (
    <Card className="w-full max-w-md p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="heading-sub text-[10px]">Your brief</p>
        <span
          aria-hidden
          className="font-display italic text-2xl leading-none text-[hsl(var(--ink-faded))]"
        >
          {numeral}
        </span>
      </div>
      <h3 className="font-display italic text-xl leading-tight">{label}</h3>
      <InkDivider />
      <dl className="flex flex-col gap-2 text-sm">
        {mode === 0 ? (
          <>
            <Field label="Topic" value={topic ?? ''} />
            <Field label="Audience" value={cap(audience ?? '')} />
          </>
        ) : (
          <>
            <Field label="Event" value={eventDescription ?? ''} />
            <Field label="Angle" value={cap(angle ?? '')} />
          </>
        )}
        <Field label="Paid in" value={tokenSymbol} />
      </dl>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="heading-sub text-[9px] text-[hsl(var(--ink-faded))]">
        {label}
      </dt>
      <dd className="text-foreground italic leading-snug">{value}</dd>
    </div>
  );
}
