'use client';

import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
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
  disabled?: boolean;
}

const MIN_LEN = 10;
const MAX_LEN = 600;

export function HotTakeInput({ onSubmit, disabled }: Props) {
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
    <Card className="w-full max-w-md p-4 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">🔥 Hot Take</h2>

      <div className="flex flex-col gap-1">
        <Label htmlFor="event">Event URL or short description</Label>
        <Textarea
          id="event"
          rows={3}
          placeholder="Paste a tweet or article URL, or describe the event in 1–2 sentences."
          value={input}
          onChange={(e) => setInput(e.target.value)}
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

      <div className="flex flex-col gap-2">
        <Label>Angle</Label>
        <RadioGroup
          value={angle}
          onValueChange={(v) => setAngle(v as Angle)}
          className="grid grid-cols-3 gap-2"
        >
          {(['bullish', 'bearish', 'skeptical'] as Angle[]).map((a) => (
            <label key={a} className="flex items-center gap-1.5 text-sm">
              <RadioGroupItem value={a} />
              <span className="capitalize">{a}</span>
            </label>
          ))}
        </RadioGroup>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading balances…</p>
      ) : (
        <TokenSelector balances={balances} selected={effectiveToken} onSelect={setSelectedToken} />
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
    </Card>
  );
}
