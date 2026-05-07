'use client';

import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { Loader2, Wallet } from 'lucide-react';
import { useBalances } from '@/lib/useBalances';
import { useIsMiniPay } from '@/lib/minipay';
import { Card } from '@/components/ui/card';

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Reads like a treasurer's ledger entry: a heading-sub label, leader-dot rows
 * for each stable, the wallet's shortened seal in monospace, and a faint
 * primary marker on the token with the highest balance — the default the
 * input forms will pre-select.
 */
export function WalletStatus() {
  const { address, isConnected, connector } = useAccount();
  const { balances, isLoading } = useBalances();
  const isMiniPay = useIsMiniPay();

  if (!isConnected || !address) return null;

  const sorted = [...balances].sort((a, b) => (a.balance > b.balance ? -1 : 1));
  const topSymbol = sorted[0] && sorted[0].balance > 0n ? sorted[0].symbol : null;

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="heading-sub text-[10px]">Coffer · Your stables</p>
        {isMiniPay && (
          <span className="font-mono text-[11px] text-[hsl(var(--ink-faded))]">
            {shorten(address)}
          </span>
        )}
      </div>

      <ul className="flex flex-col gap-1.5 text-sm">
        {isLoading && (
          <li className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2
              size={12}
              className="animate-spin text-[hsl(var(--ink-faded))]"
              aria-hidden
            />
            Reckoning balances…
          </li>
        )}

        {!isLoading && balances.length === 0 && (
          <li className="text-xs italic text-muted-foreground">
            No stable balances on this chain.
          </li>
        )}

        {!isLoading &&
          balances.map((b) => {
            const amount = Number(formatUnits(b.balance, b.decimals));
            const isTop = b.symbol === topSymbol;
            const dim = !isTop;
            return (
              <li key={b.symbol} className="flex items-baseline gap-2">
                <span
                  className={
                    'flex items-center gap-1.5 ' +
                    (dim ? 'text-muted-foreground' : 'text-foreground')
                  }
                >
                  <span
                    aria-hidden
                    className={
                      'block w-1.5 h-1.5 rounded-full ' +
                      (isTop
                        ? 'bg-primary'
                        : 'bg-[hsl(var(--ink-faded)/0.3)]')
                    }
                  />
                  <span className={isTop ? 'font-medium' : ''}>{b.symbol}</span>
                </span>
                <span
                  aria-hidden
                  className="flex-1 border-b border-dotted border-[hsl(var(--ink-faded))] mb-1 opacity-50"
                />
                <span
                  className={
                    'font-mono tabular-nums ' +
                    (dim ? 'text-muted-foreground' : 'text-foreground')
                  }
                >
                  {amount.toFixed(2)}
                </span>
              </li>
            );
          })}
      </ul>

      {isMiniPay && connector?.name && (
        <p className="text-[11px] italic text-[hsl(var(--ink-faded))] flex items-center gap-1.5 mt-0.5">
          <Wallet size={10} aria-hidden />
          Sealed via {connector.name}
        </p>
      )}
    </Card>
  );
}
