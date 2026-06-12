'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CodexFrame } from './CodexFrame';
import { IllumQuill } from './IllumIcons';
import { InkText } from './InkText';
import { InkDivider } from './InkDivider';
import { Marginalia } from './Marginalia';
import { TokenSelector } from './TokenSelector';
import { useBalances } from '@/lib/useBalances';
import type { TokenBalance } from '@/lib/useBalances';
import { computeTokenAmount } from '@/lib/tokens';
import { formatUnits } from 'viem';

export interface DailyRecapSubmitPayload {
  token: TokenBalance;
}

interface Props {
  onSubmit: (p: DailyRecapSubmitPayload) => void;
  onBack?: () => void;
  disabled?: boolean;
}

// Deliberately input-free: the agent grounds itself in today's market
// snapshot and headlines. The only choice here is which token pays.
export function DailyRecapInput({ onSubmit, onBack, disabled }: Props) {
  const { balances, isLoading } = useBalances();

  const defaultToken = useMemo(() => {
    if (!balances.length) return null;
    return [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
  }, [balances]);

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const effectiveToken = selectedToken ?? defaultToken;
  const insufficient =
    effectiveToken !== null &&
    effectiveToken.balance < computeTokenAmount(effectiveToken);

  const canSubmit = effectiveToken !== null && !insufficient && !disabled;

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
            IV
          </span>
          <IllumQuill
            size={16}
            className="absolute bottom-1 right-1 text-[hsl(var(--ink-faded))]"
          />
        </div>
        <div className="flex flex-col justify-center gap-0.5">
          <p className="heading-sub text-[10px]">Folio IV · Daily Recap</p>
          <InkText
            as="h2"
            className="font-display italic text-2xl leading-tight"
            delay={40}
          >
            Today, in one thread
          </InkText>
          <p className="text-sm text-muted-foreground leading-snug">
            Nothing to type. The agent reads today&apos;s prices, movers &amp; headlines.
          </p>
        </div>
      </div>

      <InkDivider />

      {/* I · What the agent will do */}
      <div
        className="flex flex-col gap-2"
        style={{ animation: 'form-reveal 0.55s 0.10s cubic-bezier(.2,.6,.2,1) both' }}
      >
        <p className="heading-sub text-[10px]">I · The recipe</p>
        <InkDivider />
        <ul className="text-sm text-muted-foreground leading-snug list-disc pl-4 flex flex-col gap-1">
          <li>Top-10 prices &amp; 24h moves, live from market data</li>
          <li>Today&apos;s crypto headlines via search</li>
          <li>One neutral digest, fact-checked, closing on a thing to watch</li>
        </ul>
      </div>

      {/* II · Token */}
      <div
        className="flex flex-col gap-2"
        style={{ animation: 'form-reveal 0.55s 0.20s cubic-bezier(.2,.6,.2,1) both' }}
      >
        <p className="heading-sub text-[10px]">II · Token</p>
        <InkDivider />
        {isLoading ? (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 size={12} className="animate-spin text-[hsl(var(--ink-faded))]" aria-hidden />
            Loading balances…
          </p>
        ) : (
          <TokenSelector balances={balances} selected={effectiveToken} onSelect={setSelectedToken} />
        )}
        <Marginalia side="right">fresh data every run</Marginalia>
      </div>

      {/* Cost row + Submit */}
      <div
        className="flex flex-col gap-3"
        style={{ animation: 'form-reveal 0.55s 0.30s cubic-bezier(.2,.6,.2,1) both' }}
      >
        {effectiveToken && (
          <div className="flex items-baseline gap-2 text-[11px]">
            <span className="text-muted-foreground">You pay</span>
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
          <p className="text-xs text-destructive leading-snug">
            You need {amountStr} {effectiveToken.symbol}. Top up in MiniPay or
            pick another token above.
          </p>
        )}
        <Button
          disabled={!canSubmit}
          onClick={() => {
            if (canSubmit && effectiveToken) {
              onSubmit({ token: effectiveToken });
            }
          }}
        >
          {!effectiveToken
            ? 'Select token'
            : insufficient
              ? `Not enough ${effectiveToken.symbol}`
              : `Recap today for ${amountStr} ${effectiveToken.symbol} →`}
        </Button>
      </div>

      <style jsx>{`
        @keyframes form-reveal {
          0%   { opacity: 0; transform: translateY(10px); filter: blur(1.5px); }
          100% { opacity: 1; transform: translateY(0);    filter: blur(0); }
        }
      `}</style>
    </section>
  );
}
