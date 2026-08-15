'use client';

import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { Loader2, Wallet } from 'lucide-react';
import { useBalances } from '@/lib/useBalances';
import { useIsMiniPay } from '@/lib/minipay';
import { Card } from '@/components/ui/card';
import { highestValue } from '@/lib/chainChoice';

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Wallet balance panel: a heading-sub label, one inline row of stables,
 * the wallet's shortened address in monospace, and emphasis on the token
 * with the highest balance — the default the input forms will pre-select.
 */
export function WalletStatus() {
  const { address, isConnected, connector } = useAccount();
  const { balances, isLoading, isError } = useBalances();
  const isMiniPay = useIsMiniPay();

  if (!isConnected || !address) return null;

  const topSymbol = highestValue(balances)?.symbol ?? null;

  return (
    <Card className="w-full max-w-md p-5 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="heading-sub text-[10px]">Wallet · balances</p>
        {isMiniPay && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {shorten(address)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4 text-sm">
        {isError ? (
          <span className="text-xs font-sans text-muted-foreground">
            Couldn&apos;t read balances on this chain.
          </span>
        ) : isLoading ? (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin" aria-hidden />
            Loading balances…
          </span>
        ) : balances.length === 0 ? (
          <span className="text-xs font-sans text-muted-foreground">
            No stable balances on this chain.
          </span>
        ) : (
          balances.map((b) => {
            const amount = Number(formatUnits(b.balance, b.decimals));
            const isTop = b.symbol === topSymbol;
            return (
              <span key={b.symbol} className="flex items-baseline gap-1.5">
                <span
                  className={
                    'text-xs ' + (isTop ? 'text-foreground font-medium' : 'text-muted-foreground')
                  }
                >
                  {b.symbol}
                </span>
                <span className={'font-mono tabular-nums text-money ' + (isTop ? 'font-bold' : '')}>
                  {amount.toFixed(2)}
                </span>
              </span>
            );
          })
        )}
      </div>

      {isMiniPay && connector?.name && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
          <Wallet size={10} aria-hidden />
          Connected via {connector.name}
        </p>
      )}
    </Card>
  );
}
