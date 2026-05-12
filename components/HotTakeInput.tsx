'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CodexFrame } from './CodexFrame';
import { IllumFlame } from './IllumIcons';
import { InkText } from './InkText';
import { InkDivider } from './InkDivider';
import { Marginalia } from './Marginalia';
import { TokenSelector } from './TokenSelector';
import { UrlPreviewCard } from './UrlPreviewCard';
import { useBalances, type TokenBalance } from '@/lib/useBalances';
import { computeTokenAmount } from '@/lib/tokens';
import { parseUrl } from '@/lib/urlParser';
import { formatUnits } from 'viem';

export type Angle = 'bullish' | 'bearish' | 'skeptical';

export interface HotTakeSubmitPayload {
  eventUrl: string | null;
  eventDescription: string;
  angle: Angle;
  token: TokenBalance;
}

interface Props {
  onSubmit: (p: HotTakeSubmitPayload) => void;
  onBack?: () => void;
  disabled?: boolean;
}

const MIN_LEN = 10;
const MAX_LEN = 600;

const ANGLE_OPTIONS: { value: Angle; label: string }[] = [
  { value: 'bullish', label: 'Bullish' },
  { value: 'bearish', label: 'Bearish' },
  { value: 'skeptical', label: 'Skeptical' },
];

export function HotTakeInput({ onSubmit, onBack, disabled }: Props) {
  const { balances, isLoading } = useBalances();
  const [input, setInput] = useState('');
  const [angle, setAngle] = useState<Angle>('skeptical');

  const parsed = useMemo(() => parseUrl(input), [input]);
  const isUrl = parsed !== null;

  const defaultToken = useMemo(() => {
    if (!balances.length) return null;
    return [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
  }, [balances]);

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const effectiveToken = selectedToken ?? defaultToken;

  const trimmedLen = input.trim().length;
  const canSubmit =
    trimmedLen >= MIN_LEN && trimmedLen <= MAX_LEN && effectiveToken !== null && !disabled;

  const amountStr = effectiveToken
    ? Number(formatUnits(computeTokenAmount(effectiveToken), effectiveToken.decimals)).toFixed(2)
    : '';

  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={disabled}
          className="self-start flex items-center gap-1.5 heading-sub text-[10px] no-underline hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ animation: 'form-reveal 0.45s 0s cubic-bezier(.2,.6,.2,1) both' }}
        >
          <ArrowLeft size={12} aria-hidden />
          Folio I · Modes
        </button>
      )}

      {/* Header: folio numeral + icon + title */}
      <div
        className="flex items-stretch gap-4"
        style={{ animation: 'form-reveal 0.55s 0s cubic-bezier(.2,.6,.2,1) both' }}
      >
        <div className="relative w-16 h-16 shrink-0 flex items-center justify-center text-primary">
          <CodexFrame
            animated
            className="absolute inset-0 w-full h-full text-[hsl(var(--ink-faded))] opacity-70"
          />
          <span
            className="relative font-display italic text-[2.4rem] leading-none select-none"
            aria-hidden
          >
            II
          </span>
          <IllumFlame
            size={16}
            className="absolute bottom-1 right-1 text-[hsl(var(--ink-faded))]"
          />
        </div>
        <div className="flex flex-col justify-center gap-0.5">
          <p className="heading-sub text-[10px]">Folio II · Hot Take</p>
          <InkText
            as="h2"
            className="font-display italic text-2xl leading-tight"
            delay={40}
          >
            Load the chamber
          </InkText>
          <p className="text-sm italic text-muted-foreground leading-snug">
            Paste a URL or describe the event.
          </p>
        </div>
      </div>

      <InkDivider />

      {/* I · Event */}
      <div
        className="flex flex-col gap-2"
        style={{ animation: 'form-reveal 0.55s 0.10s cubic-bezier(.2,.6,.2,1) both' }}
      >
        <label htmlFor="event" className="heading-sub text-[10px]">I · Event</label>
        <InkDivider />
        <Textarea
          id="event"
          rows={3}
          placeholder="Paste a tweet or article URL, or describe the event in 1–2 sentences."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled}
        />
        <p
          className={`text-xs font-mono ${
            trimmedLen > MAX_LEN ? 'text-destructive' : 'text-muted-foreground'
          }`}
        >
          {trimmedLen}/{MAX_LEN}
        </p>
        {isUrl && parsed && <UrlPreviewCard url={parsed.url} />}
      </div>

      {/* II · Angle */}
      <div
        className="flex flex-col gap-2"
        style={{ animation: 'form-reveal 0.55s 0.20s cubic-bezier(.2,.6,.2,1) both' }}
      >
        <p className="heading-sub text-[10px]">II · Angle</p>
        <InkDivider />
        <div className="flex gap-2 flex-wrap">
          {ANGLE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              aria-pressed={angle === opt.value}
              onClick={() => setAngle(opt.value)}
              className={`px-3 py-1 rounded-full text-xs border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                angle === opt.value
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-[hsl(var(--ink-faded))] text-muted-foreground hover:border-primary/50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* III · Token */}
      <div
        className="flex flex-col gap-2"
        style={{ animation: 'form-reveal 0.55s 0.30s cubic-bezier(.2,.6,.2,1) both' }}
      >
        <p className="heading-sub text-[10px]">III · Token</p>
        <InkDivider />
        {isLoading ? (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 size={12} className="animate-spin text-[hsl(var(--ink-faded))]" aria-hidden />
            Loading balances…
          </p>
        ) : (
          <TokenSelector balances={balances} selected={effectiveToken} onSelect={setSelectedToken} />
        )}
        <Marginalia side="right">same cost either angle</Marginalia>
      </div>

      {/* Cost row + Submit */}
      <div
        className="flex flex-col gap-3"
        style={{ animation: 'form-reveal 0.55s 0.40s cubic-bezier(.2,.6,.2,1) both' }}
      >
        {effectiveToken && (
          <div className="flex items-baseline gap-2 text-[11px]">
            <span className="italic text-muted-foreground">You pay</span>
            <span
              aria-hidden
              className="flex-1 border-b border-dotted border-[hsl(var(--ink-faded))] mb-1 opacity-50"
            />
            <span className="font-mono text-[hsl(var(--ink-faded))]">
              {amountStr} {effectiveToken.symbol}
            </span>
          </div>
        )}
        <Button
          disabled={!canSubmit}
          onClick={() => {
            if (canSubmit && effectiveToken) {
              onSubmit({
                eventUrl: isUrl ? parsed!.url : null,
                eventDescription: input.trim(),
                angle,
                token: effectiveToken,
              });
            }
          }}
        >
          {effectiveToken ? `Generate for ${amountStr} ${effectiveToken.symbol} →` : 'Select token'}
        </Button>
      </div>

      <style jsx>{`
        @keyframes form-reveal {
          0%   { opacity: 0; transform: translateY(10px); filter: blur(1.5px); }
          100% { opacity: 1; transform: translateY(0);    filter: blur(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: 0.01ms !important; animation-delay: 0ms !important; }
        }
      `}</style>
    </section>
  );
}
