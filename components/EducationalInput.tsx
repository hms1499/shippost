'use client';

import { useState, useMemo } from 'react';
import { ArrowLeft, GraduationCap, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { RuleDivider } from '@/components/terminal/RuleDivider';
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
        >
          <ArrowLeft size={12} aria-hidden />
          Modes
        </button>
      )}

      <TerminalPanel variant="plain" className="w-full">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <GraduationCap size={18} className="text-primary shrink-0" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <p className="heading-sub text-[10px]">Educational thread</p>
              <h2 className="font-mono font-bold text-xl leading-tight tracking-tight">
                Configure the run
              </h2>
            </div>
          </div>
          <p className="text-sm text-muted-foreground leading-snug">
            Describe the concept and the reader.
          </p>

          <RuleDivider />

          {/* Topic */}
          <div className="flex flex-col gap-2">
            <label htmlFor="topic" className="heading-sub text-[10px]">Topic</label>
            <div className="flex items-center rounded-md border border-input bg-card px-3 py-2 font-mono text-sm">
              <span className="text-primary select-none">&gt;&nbsp;</span>
              <Input
                id="topic"
                placeholder="e.g. EIP-7702 account abstraction"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                disabled={disabled}
                className="flex-1 h-auto border-0 bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
          </div>

          {/* Audience */}
          <div className="flex flex-col gap-2">
            <p className="heading-sub text-[10px]">Audience</p>
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
              <TokenSelector
                balances={balances}
                selected={effectiveToken}
                onSelect={setSelectedToken}
              />
            )}
            <p className="text-xs font-sans text-muted-foreground">Highest balance pre-selected.</p>
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
              <p className="text-xs text-destructive leading-snug">
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
        </div>
      </TerminalPanel>
    </section>
  );
}
