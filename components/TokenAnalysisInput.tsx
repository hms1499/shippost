'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Coins, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { TokenSelector } from './TokenSelector';
import { useBalances } from '@/lib/useBalances';
import type { TokenBalance } from '@/lib/useBalances';
import { computeTokenAmount } from '@/lib/tokens';
import { normalizeTicker } from '@/lib/prompts/tokenAnalysis';
import type { Angle } from './HotTakeInput';
import { formatUnits } from 'viem';

export interface TokenAnalysisSubmitPayload {
  ticker: string; // raw user input; the server normalises to $CASHTAG
  angle: Angle;
  token: TokenBalance;
}

interface Props {
  onSubmit: (p: TokenAnalysisSubmitPayload) => void;
  onBack?: () => void;
  disabled?: boolean;
  /** free-preview draft in flight — disables the form and swaps the CTA label */
  submitting?: boolean;
}

const MIN_LEN = 1;
const MAX_LEN = 10;

const ANGLE_OPTIONS: { value: Angle; label: string }[] = [
  { value: 'bullish', label: 'Bullish' },
  { value: 'bearish', label: 'Bearish' },
  { value: 'skeptical', label: 'Skeptical' },
];

export function TokenAnalysisInput({ onSubmit, onBack, disabled, submitting }: Props) {
  const { balances, isLoading } = useBalances();
  const [input, setInput] = useState('');
  const [angle, setAngle] = useState<Angle>('skeptical');

  // Live, normalised echo of what the agent will actually look up ($CELO).
  const normalized = useMemo(() => normalizeTicker(input), [input]);
  const hasTicker = normalized.length > 1; // more than the bare "$"

  const defaultToken = useMemo(() => {
    if (!balances.length) return null;
    return [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
  }, [balances]);

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);
  const effectiveToken = selectedToken ?? defaultToken;
  const insufficient =
    effectiveToken !== null &&
    effectiveToken.balance < computeTokenAmount(effectiveToken);

  const trimmedLen = input.trim().length;
  const canSubmit =
    trimmedLen >= MIN_LEN &&
    trimmedLen <= MAX_LEN &&
    hasTicker &&
    effectiveToken !== null &&
    !insufficient &&
    !disabled &&
    !submitting;

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
            <Coins size={18} className="text-primary shrink-0" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <p className="heading-sub text-[10px]">Token analysis</p>
              <h2 className="font-mono font-bold text-xl leading-tight tracking-tight">
                Query a token
              </h2>
            </div>
          </div>
          <p className="text-sm font-sans text-muted-foreground leading-snug">
            Name a token. The agent reads price, mcap &amp; catalysts.
          </p>

          <RuleDivider />

          {/* Ticker */}
          <div className="flex flex-col gap-2">
            <label htmlFor="ticker" className="heading-sub text-[10px]">Ticker</label>
            <div className="flex items-center rounded-md border border-input bg-card px-3 py-2 font-mono text-sm">
              <span className="text-primary select-none">&gt;&nbsp;</span>
              <Input
                id="ticker"
                placeholder="CELO, BTC, $ETH…"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={disabled}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={MAX_LEN + 2}
                className="flex-1 h-auto border-0 bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            <p className="text-xs font-mono text-muted-foreground">
              {hasTicker ? (
                <>Agent looks up <span className="text-foreground">{normalized}</span></>
              ) : (
                'Enter a token symbol (1–10 chars)'
              )}
            </p>
          </div>

          {/* Angle */}
          <div className="flex flex-col gap-2">
            <p id="angle-label" className="heading-sub text-[10px]">Angle</p>
            <div role="group" aria-labelledby="angle-label" className="flex gap-2 flex-wrap">
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
                      : 'border-border text-muted-foreground hover:border-primary/50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
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
                  onSubmit({ ticker: input.trim(), angle, token: effectiveToken });
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
                  : `Analyse for ${amountStr} ${effectiveToken.symbol} →`}
            </Button>
          </div>
        </div>
      </TerminalPanel>
    </section>
  );
}
