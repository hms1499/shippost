'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CodexFrame } from './CodexFrame';
import { IllumCoin } from './IllumIcons';
import { InkText } from './InkText';
import { InkDivider } from './InkDivider';
import { Marginalia } from './Marginalia';
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
}

const MIN_LEN = 1;
const MAX_LEN = 10;

const ANGLE_OPTIONS: { value: Angle; label: string }[] = [
  { value: 'bullish', label: 'Bullish' },
  { value: 'bearish', label: 'Bearish' },
  { value: 'skeptical', label: 'Skeptical' },
];

export function TokenAnalysisInput({ onSubmit, onBack, disabled }: Props) {
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
    !disabled;

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
            III
          </span>
          <IllumCoin
            size={16}
            className="absolute bottom-1 right-1 text-[hsl(var(--ink-faded))]"
          />
        </div>
        <div className="flex flex-col justify-center gap-0.5">
          <p className="heading-sub text-[10px]">Folio III · Token Analysis</p>
          <InkText
            as="h2"
            className="font-display italic text-2xl leading-tight"
            delay={40}
          >
            Weigh the coin
          </InkText>
          <p className="text-sm text-muted-foreground leading-snug">
            Name a token. The agent reads price, mcap & catalysts.
          </p>
        </div>
      </div>

      <InkDivider />

      {/* I · Ticker */}
      <div
        className="flex flex-col gap-2"
        style={{ animation: 'form-reveal 0.55s 0.10s cubic-bezier(.2,.6,.2,1) both' }}
      >
        <label htmlFor="ticker" className="heading-sub text-[10px]">I · Ticker</label>
        <InkDivider />
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
        />
        <p className="text-xs font-mono text-muted-foreground">
          {hasTicker ? (
            <>Agent looks up <span className="text-[hsl(var(--ink-faded))]">{normalized}</span></>
          ) : (
            'Enter a token symbol (1–10 chars)'
          )}
        </p>
      </div>

      {/* II · Angle */}
      <div
        className="flex flex-col gap-2"
        style={{ animation: 'form-reveal 0.55s 0.20s cubic-bezier(.2,.6,.2,1) both' }}
      >
        <p id="angle-label" className="heading-sub text-[10px]">II · Angle</p>
        <InkDivider />
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
              onSubmit({ ticker: input.trim(), angle, token: effectiveToken });
            }
          }}
        >
          {!effectiveToken
            ? 'Select token'
            : insufficient
              ? `Not enough ${effectiveToken.symbol}`
              : `Analyse for ${amountStr} ${effectiveToken.symbol} →`}
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
