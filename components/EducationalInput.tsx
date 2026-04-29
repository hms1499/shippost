'use client';

import { useState, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { TokenSelector } from './TokenSelector';
import { useBalances, type TokenBalance } from '@/lib/useBalances';
import { computeTokenAmount } from '@/lib/tokens';
import { formatUnits } from 'viem';

export interface EducationalSubmitPayload {
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  token: TokenBalance;
}

interface Props {
  onSubmit: (payload: EducationalSubmitPayload) => void;
  disabled?: boolean;
}

export function EducationalInput({ onSubmit, disabled }: Props) {
  const { balances, isLoading } = useBalances();
  const [topic, setTopic] = useState('');
  const [audience, setAudience] = useState<'beginner' | 'intermediate' | 'advanced'>('beginner');
  const [length, setLength] = useState<5 | 8 | 12>(8);

  const defaultToken = useMemo(() => {
    if (!balances.length) return null;
    return [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1))[0];
  }, [balances]);

  const [selectedToken, setSelectedToken] = useState<TokenBalance | null>(null);

  const effectiveToken = selectedToken ?? defaultToken;

  const canSubmit = topic.trim().length > 0 && effectiveToken !== null && !disabled;

  const amountStr = effectiveToken
    ? Number(formatUnits(computeTokenAmount(effectiveToken), effectiveToken.decimals)).toFixed(2)
    : '';

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-4">
      <h2 className="text-lg font-semibold">🎓 Educational Thread</h2>

      <div className="flex flex-col gap-1">
        <Label htmlFor="topic">Topic</Label>
        <Input
          id="topic"
          placeholder="e.g. EIP-7702 account abstraction"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Audience</Label>
        <RadioGroup
          value={audience}
          onValueChange={(v) => setAudience(v as typeof audience)}
          className="flex gap-4"
        >
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="beginner" />
            <span className="text-sm">Beginner</span>
          </label>
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="intermediate" />
            <span className="text-sm">Intermediate</span>
          </label>
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="advanced" />
            <span className="text-sm">Advanced</span>
          </label>
        </RadioGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Length</Label>
        <RadioGroup
          value={String(length)}
          onValueChange={(v) => setLength(Number(v) as 5 | 8 | 12)}
          className="flex gap-4"
        >
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="5" />
            <span className="text-sm">5 tweets</span>
          </label>
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="8" />
            <span className="text-sm">8 tweets</span>
          </label>
          <label className="flex items-center gap-1.5">
            <RadioGroupItem value="12" />
            <span className="text-sm">12 tweets</span>
          </label>
        </RadioGroup>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading balances…</p>
      ) : (
        <TokenSelector
          balances={balances}
          selected={effectiveToken}
          onSelect={setSelectedToken}
        />
      )}

      <Button
        disabled={!canSubmit}
        onClick={() => {
          if (canSubmit && effectiveToken) {
            onSubmit({ topic, audience, length, token: effectiveToken });
          }
        }}
      >
        {effectiveToken
          ? `Generate for ${amountStr} ${effectiveToken.symbol} →`
          : 'Select token'}
      </Button>
    </Card>
  );
}
