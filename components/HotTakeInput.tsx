'use client';

import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft, Flame, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { TokenSelector } from './TokenSelector';
import { UrlPreviewCard, type UrlPreview } from './UrlPreviewCard';
import { useBalances, type TokenBalance } from '@/lib/useBalances';
import { useThreadPrice } from '@/lib/useThreadPrice';
import { payability } from '@/lib/payability';
import { computeTokenAmount } from '@/lib/tokens';
import { highestValue } from '@/lib/chainChoice';
import { parseUrl } from '@/lib/urlParser';
import type { EventContext } from '@/lib/eventContext';
import { formatUnits } from 'viem';

export type Angle = 'bullish' | 'bearish' | 'skeptical';

export interface HotTakeSubmitPayload {
  eventUrl: string | null;
  eventDescription: string;
  angle: Angle;
  token: TokenBalance;
  // OG metadata of the pasted URL (when resolved), so the agent reads the
  // article instead of the raw URL string. Null when no URL / preview failed.
  eventContext: EventContext | null;
}

interface Props {
  onSubmit: (p: HotTakeSubmitPayload) => void;
  onBack?: () => void;
  disabled?: boolean;
  /** free-preview draft in flight — disables the form and swaps the CTA label */
  submitting?: boolean;
}

const MIN_LEN = 10;
const MAX_LEN = 600;

const ANGLE_OPTIONS: { value: Angle; label: string }[] = [
  { value: 'bullish', label: 'Bullish' },
  { value: 'bearish', label: 'Bearish' },
  { value: 'skeptical', label: 'Skeptical' },
];

export function HotTakeInput({ onSubmit, onBack, disabled, submitting }: Props) {
  const { balances, isLoading, isError } = useBalances();
  const [input, setInput] = useState('');
  const [angle, setAngle] = useState<Angle>('skeptical');

  const parsed = useMemo(() => parseUrl(input), [input]);
  const isUrl = parsed !== null;

  // Capture the OG metadata UrlPreviewCard fetches for display, so we can
  // forward it to generation (the agent reads the article, not the URL string).
  const [urlPreview, setUrlPreview] = useState<UrlPreview | null>(null);
  const onPreviewResolved = useCallback((p: UrlPreview) => setUrlPreview(p), []);

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

  const trimmedLen = input.trim().length;
  // Only nag once they've started typing — an empty box explains itself.
  const tooShort = trimmedLen > 0 && trimmedLen < MIN_LEN;
  // Deliberately NOT gated on `insufficient`: this button buys the free
  // preview, so requiring a fundable balance locked empty wallets — new MiniPay
  // users, i.e. exactly the organic ones — out of trying the product at all.
  // Balance is checked where it matters, at unlock.
  const canSubmit =
    trimmedLen >= MIN_LEN &&
    trimmedLen <= MAX_LEN &&
    effectiveToken !== null &&
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
            <Flame size={18} className="text-primary shrink-0" aria-hidden />
            <div className="flex flex-col gap-0.5">
              <p className="heading-sub text-[10px]">Hot take</p>
              <h2 className="font-mono font-bold text-xl leading-tight tracking-tight">
                Set the input
              </h2>
            </div>
          </div>
          <p className="text-sm font-sans text-muted-foreground leading-snug">
            Paste a URL or describe the event.
          </p>

          <RuleDivider />

          {/* Event */}
          <div className="flex flex-col gap-2">
            <label htmlFor="event" className="heading-sub text-[10px]">Event</label>
            <div className="flex items-start rounded-md border border-input bg-card px-3 py-2 font-mono text-sm">
              <span className="text-primary select-none">&gt;&nbsp;</span>
              <Textarea
                id="event"
                rows={3}
                placeholder="Paste a tweet or article URL, or describe the event in 1–2 sentences."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={disabled}
                aria-describedby={tooShort ? 'event-min-hint' : undefined}
                className="flex-1 h-auto min-h-0 border-0 bg-transparent px-0 py-0 focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <p
                className={`text-xs font-mono ${
                  trimmedLen > MAX_LEN ? 'text-destructive' : 'text-muted-foreground'
                }`}
              >
                {trimmedLen}/{MAX_LEN}
              </p>
              {/* The counter only ever showed the ceiling, so a short entry left
                  Submit disabled with nothing on screen explaining why. */}
              {tooShort && (
                <p id="event-min-hint" className="text-xs font-sans text-muted-foreground leading-snug">
                  At least {MIN_LEN} characters.
                </p>
              )}
            </div>
            {isUrl && parsed && (
              <UrlPreviewCard url={parsed.url} onResolved={onPreviewResolved} />
            )}
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

          {/* Token — TokenSelector already labels itself "Pay with", so the
              extra "TOKEN" heading that used to sit here was a duplicate. */}
          {isLoading ? (
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              <Loader2 size={12} className="animate-spin text-muted-foreground" aria-hidden />
              Loading balances…
            </p>
          ) : (
            <TokenSelector balances={balances} selected={effectiveToken} onSelect={setSelectedToken} />
          )}

          {/* Submit, then the cost as fine print. Pressing this spends nothing:
              it fetches the free preview, and paying is a separate decision on
              the next screen. The old "You pay / 0.05 cUSD" ledger row above the
              button announced a charge that does not happen here. */}
          <div className="flex flex-col gap-3">
            <Button
              disabled={!canSubmit}
              onClick={() => {
                if (canSubmit && effectiveToken) {
                  // Only forward context for the URL currently in the box, and only
                  // when the preview actually resolved with usable text.
                  const ctx: EventContext | null =
                    isUrl && urlPreview && !urlPreview.error && (urlPreview.title || urlPreview.description)
                      ? {
                          title: urlPreview.title,
                          description: urlPreview.description,
                          host: urlPreview.host,
                          kind: urlPreview.kind,
                        }
                      : null;
                  onSubmit({
                    eventUrl: parsed?.url ?? null,
                    eventDescription: input.trim(),
                    angle,
                    token: effectiveToken,
                    eventContext: ctx,
                  });
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
