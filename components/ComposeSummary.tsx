'use client';

import { Card } from '@/components/ui/card';
import { RuleDivider } from '@/components/terminal/RuleDivider';

interface ComposeSummaryProps {
  mode: 0 | 1 | 2 | 3;
  tokenSymbol: string;
  topic?: string;
  audience?: string;
  eventDescription?: string;
  angle?: string;
  ticker?: string;
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
  ticker,
}: ComposeSummaryProps) {
  const order = mode === 1 ? 1 : mode === 0 ? 2 : mode === 2 ? 3 : 4;
  const label =
    mode === 0 ? 'Educational' : mode === 1 ? 'Hot Take' : mode === 2 ? 'Token Analysis' : 'Daily Recap';

  return (
    <Card className="w-full max-w-md p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="heading-sub text-[10px]">Your brief</p>
        <span
          aria-hidden
          className="font-mono font-bold text-sm leading-none text-muted-foreground"
        >
          {String(order).padStart(2, '0')}
        </span>
      </div>
      <h3 className="font-mono font-bold text-xl leading-tight tracking-tight">{label}</h3>
      <RuleDivider />
      <dl className="flex flex-col gap-2 text-sm">
        {mode === 0 ? (
          <>
            <Field label="Topic" value={topic ?? ''} />
            <Field label="Audience" value={cap(audience ?? '')} />
          </>
        ) : mode === 2 ? (
          <>
            <Field label="Ticker" value={ticker ?? ''} />
            <Field label="Angle" value={cap(angle ?? '')} />
          </>
        ) : mode === 3 ? (
          <Field label="Brief" value="Today's market, recapped" />
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
      <dt className="heading-sub text-[9px] text-muted-foreground">
        {label}
      </dt>
      <dd className="text-foreground leading-snug">{value}</dd>
    </div>
  );
}
