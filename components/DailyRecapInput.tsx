'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Loader2, PenLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { TokenSelector } from './TokenSelector';
import { useBalances } from '@/lib/useBalances';
import { useThreadPrice } from '@/lib/useThreadPrice';
import { payability } from '@/lib/payability';
import type { TokenBalance } from '@/lib/useBalances';
import { computeTokenAmount } from '@/lib/tokens';
import { highestValue } from '@/lib/chainChoice';
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
  const { balances, isLoading, isError } = useBalances();

  const defaultToken = useMemo(() => {
    if (!balances.length) return null;
    return highestValue(balances) ?? balances[0];
  }, [balances]);

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const effectiveToken = selectedToken ?? defaultToken;
  // Compared against the on-chain price, not computeTokenAmount: the price is
  // settable, so a local constant can warn a wallet that can in fact afford it.
  const threadPrice = useThreadPrice(effectiveToken);
  const payGate = payability({
    token: effectiveToken,
    price: threadPrice,
    balancesLoading: isLoading,
    balancesError: isError,
  });
  const insufficient = !payGate.canPay && payGate.reason !== 'no-token';

  // Deliberately NOT gated on `insufficient`: this button buys the free
  // preview, so requiring a fundable balance locked empty wallets — new MiniPay
  // users, i.e. exactly the organic ones — out of trying the product at all.
  // Balance is checked where it matters, at unlock.
  const canSubmit = effectiveToken !== null && !disabled && !submitting;

  const amountStr = effectiveToken
    // The chain's price, with the constant only as the fallback for the frames
    // before the read lands. These screens named THREAD_PRICE_USD while the gate
    // right above them was already comparing against the real price — so prod
    // Celo quoted $0.10 for a thread its contract sells at $0.05.
    ? Number(
        formatUnits(
          threadPrice ?? computeTokenAmount(effectiveToken),
          effectiveToken.decimals,
        ),
      ).toFixed(2)
    : '';

  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={disabled || submitting}
          className="self-start flex items-center gap-1.5 min-h-9 px-1 -mx-1 rounded heading-sub text-[10px] no-underline hover:text-primary active:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Token — TokenSelector already labels itself "Pay with", so the
              extra "TOKEN" heading that used to sit here was a duplicate. */}
          <div className="flex flex-col gap-2">
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

          {/* Submit, then the cost as fine print. Pressing this spends nothing:
              it fetches the free preview, and paying is a separate decision on
              the next screen. */}
          <div className="flex flex-col gap-3">
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
                : 'Generate preview — free →'}
            </Button>
            {effectiveToken && (
              <p className="text-xs font-sans text-muted-foreground leading-snug">
                The first tweet is free. You pay{' '}
                <span className="font-mono text-money">
                  {amountStr} {effectiveToken.symbol}
                </span>{' '}
                only if you unlock the full thread.
              </p>
            )}
            {insufficient && effectiveToken && (
              <p className="text-xs font-sans text-muted-foreground leading-snug">
                Your {effectiveToken.symbol} balance won&apos;t cover the unlock yet
                — top up in MiniPay or switch token before that step. The preview
                still works.
              </p>
            )}
          </div>
        </div>
      </TerminalPanel>
    </section>
  );
}
