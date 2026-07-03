'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Loader2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { RuleDivider } from '@/components/terminal/RuleDivider';
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
  /** free-preview draft in flight — disables the form and swaps the CTA label */
  submitting?: boolean;
}

// Deliberately input-free: the agent grounds itself in today's market
// snapshot and headlines. The only choice here is which token pays.
export function DailyRecapInput({ onSubmit, onBack, disabled, submitting }: Props) {
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

  const canSubmit = effectiveToken !== null && !insufficient && !disabled && !submitting;

  const amountStr = effectiveToken
    ? Number(formatUnits(computeTokenAmount(effectiveToken), effectiveToken.decimals)).toFixed(2)
    : '';

  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={disabled || submitting}
          className="self-start flex items-center gap-1.5 heading-sub text-[10px] no-underline hover:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <ArrowLeft size={12} aria-hidden />
          Modes
        </button>
      )}

      <TerminalPanel variant="plain" className="w-full">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <PenLine size={18} className="text-primary shrink-0" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <p className="heading-sub text-[10px]">Daily recap</p>
              <h2 className="font-mono font-bold text-xl leading-tight tracking-tight">
                Today, in one thread
              </h2>
            </div>
          </div>
          <p className="text-sm font-sans text-muted-foreground leading-snug">
            Nothing to type. The agent reads today&apos;s prices, movers &amp; headlines.
          </p>

          <RuleDivider />

          {/* What the agent will do */}
          <div className="flex flex-col gap-2">
            <p className="heading-sub text-[10px]">The recipe</p>
            <ul className="text-sm font-sans text-muted-foreground leading-snug list-disc pl-4 flex flex-col gap-1">
              <li>Top-10 prices &amp; 24h moves, live from market data</li>
              <li>Today&apos;s crypto headlines via search</li>
              <li>One neutral digest, fact-checked, closing on a thing to watch</li>
            </ul>
          </div>

          {/* Token */}
          <div className="flex flex-col gap-2">
            <p className="heading-sub text-[10px]">Token</p>
            {isLoading ? (
              <p className="text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 size={12} className="animate-spin text-muted-foreground" aria-hidden />
                Loading balances…
              </p>
            ) : (
              <TokenSelector balances={balances} selected={effectiveToken} onSelect={setSelectedToken} />
            )}
            <p className="text-xs font-sans text-muted-foreground">Fresh data every run.</p>
          </div>

          {/* Cost row + Submit */}
          <div className="flex flex-col gap-3">
            {effectiveToken && (
              <div className="flex items-baseline gap-2 text-[11px]">
                <span className="text-muted-foreground">You pay</span>
                <span
                  aria-hidden
                  className="flex-1 border-b border-dotted border-border mb-1 opacity-50"
                />
                <span className="font-mono text-money">
                  {amountStr} {effectiveToken.symbol}
                </span>
              </div>
            )}
            {insufficient && effectiveToken && (
              <p className="text-xs font-sans text-destructive leading-snug">
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
              {submitting ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                  Drafting sample…
                </>
              ) : !effectiveToken
                ? 'Select token'
                : insufficient
                  ? `Not enough ${effectiveToken.symbol}`
                  : `Recap today for ${amountStr} ${effectiveToken.symbol} →`}
            </Button>
          </div>
        </div>
      </TerminalPanel>
    </section>
  );
}
