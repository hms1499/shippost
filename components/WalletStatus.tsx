'use client';

import { useAccount } from 'wagmi';
import { formatUnits } from 'viem';
import { useBalances } from '@/lib/useBalances';
import { useIsMiniPay } from '@/lib/minipay';
import { Card } from '@/components/ui/card';

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function WalletStatus() {
  const { address, isConnected, connector } = useAccount();
  const { balances, isLoading } = useBalances();
  const isMiniPay = useIsMiniPay();

  if (!isConnected || !address) return null;

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-2">
      {isMiniPay ? (
        <div className="flex justify-between items-center">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">
              Connected{connector?.name ? ` · ${connector.name}` : ''}
            </span>
            <span className="font-mono text-sm">{shorten(address)}</span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-muted-foreground">Balances</div>
      )}
      <div className={isMiniPay ? 'border-t border-border pt-2 flex flex-col gap-1' : 'flex flex-col gap-1'}>
        {isLoading && <span className="text-xs text-muted-foreground">Loading balances…</span>}
        {!isLoading &&
          balances.map((b) => (
            <div key={b.symbol} className="flex justify-between text-sm">
              <span>{b.symbol}</span>
              <span className="font-mono">
                {Number(formatUnits(b.balance, b.decimals)).toFixed(2)}
              </span>
            </div>
          ))}
      </div>
    </Card>
  );
}
