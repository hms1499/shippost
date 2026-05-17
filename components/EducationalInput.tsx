'use client';

import { useState, useMemo } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CodexFrame } from './CodexFrame';
import { IllumGraduationCap } from './IllumIcons';
import { InkText } from './InkText';
import { InkDivider } from './InkDivider';
import { Marginalia } from './Marginalia';
import { TokenSelector } from './TokenSelector';
import { useBalances, type TokenBalance } from '@/lib/useBalances';
import { computeTokenAmount } from '@/lib/tokens';
import { formatUnits } from 'viem';

export interface EducationalSubmitPayload {
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  token: TokenBalance;
}

interface Props {
  onSubmit: (payload: EducationalSubmitPayload) => void;
  onBack?: () => void;
  disabled?: boolean;
}

const AUDIENCE_OPTIONS = [
  { value: 'beginner' as const, label: 'Beginner' },
  { value: 'intermediate' as const, label: 'Intermediate' },
  { value: 'advanced' as const, label: 'Advanced' },
];

export function EducationalInput({ onSubmit, onBack, disabled }: Props) {
  const { balances, isLoading } = useBalances();
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');

  const defaultToken = useMemo(() => {
    if (!balances.length) return null;
    return [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
  }, [balances]);

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const effectiveToken = selectedToken ?? defaultToken;
  const insufficient =
    effectiveToken !== null &&
    effectiveToken.balance < computeTokenAmount(effectiveToken);
  const canSubmit =
    topic.trim().length > 0 && effectiveToken !== null && !insufficient && !disabled;

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
            I
          </span>
          <IllumGraduationCap
            size={16}
            className="absolute bottom-1 right-1 text-[hsl(var(--ink-faded))]"
          />
        </div>
        <div className="flex flex-col justify-center gap-0.5">
          <p className="heading-sub text-[10px]">Folio I · Educational Thread</p>
          <InkText
            as="h2"
            className="font-display italic text-2xl leading-tight"
            delay={40}
          >
            Set the quill
          </InkText>
          <p className="text-sm italic text-muted-foreground leading-snug">
            Describe the concept and the reader.
          </p>
        </div>
      </div>

      <InkDivider />

      {/* I · Topic */}
      <div
        className="flex flex-col gap-2"
        style={{ animation: 'form-reveal 0.55s 0.10s cubic-bezier(.2,.6,.2,1) both' }}
      >
        <label htmlFor="topic" className="heading-sub text-[10px]">I · Topic</label>
        <InkDivider />
        <Input
          id="topic"
          placeholder="e.g. EIP-7702 account abstraction"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          disabled={disabled}
        />
      </div>

      {/* II · Audience */}
      <div
        className="flex flex-col gap-2"
        style={{ animation: 'form-reveal 0.55s 0.20s cubic-bezier(.2,.6,.2,1) both' }}
      >
        <p className="heading-sub text-[10px]">II · Audience</p>
        <InkDivider />
        <div className="flex gap-2 flex-wrap">
          {AUDIENCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              aria-pressed={audience === opt.value}
              onClick={() => setAudience(opt.value)}
              className={`px-3 py-1 rounded-full text-xs border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                audience === opt.value
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
          <TokenSelector
            balances={balances}
            selected={effectiveToken}
            onSelect={setSelectedToken}
          />
        )}
        <Marginalia side="right">highest balance pre-selected</Marginalia>
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
        {insufficient && effectiveToken && (
          <p className="text-xs text-destructive italic leading-snug">
            You need {amountStr} {effectiveToken.symbol}. Top up in MiniPay or
            pick another token above.
          </p>
        )}
        <Button
          disabled={!canSubmit}
          onClick={() => {
            if (canSubmit && effectiveToken) {
              onSubmit({ topic, audience, token: effectiveToken });
            }
          }}
        >
          {!effectiveToken
            ? 'Select token'
            : insufficient
              ? `Not enough ${effectiveToken.symbol}`
              : `Generate for ${amountStr} ${effectiveToken.symbol} →`}
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
