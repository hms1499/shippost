'use client';

import { formatUnits } from 'viem';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import type { TokenBalance } from '@/lib/useBalances';

interface Props {
  balances: TokenBalance[];
  selected: TokenBalance | null;
  onSelect: (token: TokenBalance) => void;
}

export function TokenSelector({ balances, selected, onSelect }: Props) {
  if (balances.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">Pay with</Label>
      <Select
        value={selected?.symbol ?? ''}
        onValueChange={(sym) => {
          const t = balances.find((b) => b.symbol === sym);
          if (t) onSelect(t);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder="Select token" />
        </SelectTrigger>
        <SelectContent>
          {balances.map((b) => (
            <SelectItem key={b.symbol} value={b.symbol} textValue={b.symbol}>
              <span className="flex items-baseline gap-2">
                <span className="font-medium">{b.symbol}</span>
                <span className="text-money font-mono text-xs">
                  {Number(formatUnits(b.balance, b.decimals)).toFixed(2)}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
