'use client';

import { useAccount, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { Loader2, Wallet } from 'lucide-react';
import { useBalances } from '@/lib/useBalances';
import { useNativeBalance } from '@/lib/useNativeBalance';
import { formatNativeAmount } from '@/lib/formatNative';
import { useIsMiniPay } from '@/lib/minipay';
import { Card } from '@/components/ui/card';
import { highestValue } from '@/lib/chainChoice';
import { SUPPORTED_CHAIN_IDS, chainLabel } from '@/lib/chainPolicy';

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function NativeChip({
  symbol,
  value,
  decimals,
  loading,
}: {
  symbol: string;
  value: bigint;
  decimals: number;
  loading: boolean;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-xs text-muted-foreground">{symbol}</span>
      {loading ? (
        <Loader2 size={10} className="animate-spin text-muted-foreground" aria-hidden />
      ) : (
        <span className="font-mono tabular-nums text-muted-foreground">
          {formatNativeAmount(value, decimals)}
        </span>
      )}
    </span>
  );
}

/**
 * Wallet balance panel: a heading-sub label, one inline row of stables
 * plus the native gas token (ETH on Base, CELO on Celo), the wallet's
 * shortened address in monospace, and emphasis on the payable token
 * with the highest balance — the default the input forms will pre-select.
 * Native is display-only and never enters the pay token list.
 */
export function WalletStatus() {
  const { address, isConnected, connector } = useAccount();
  const chainId = useChainId();
  const { balances, isLoading, isError } = useBalances();
  const { native, isLoading: nativeLoading } = useNativeBalance();
  const isMiniPay = useIsMiniPay();

  // "Empty" is every balance at zero, not an absent token list: every supported
  // chain configures at least one token, so balances.length is never 0 on a
  // successful read and a zero-only wallet would otherwise read as "USDC 0.00"
  // with no way forward.
  const hasFunds = balances.some((b) => b.balance > 0n);
  const otherChainId = SUPPORTED_CHAIN_IDS.find((id) => id !== chainId);
  // The one moment a spare RPC call earns its keep — the user is stuck here.
  // MiniPay is excluded because it cannot act on the answer (no dapp-side
  // chain switching), so the call would buy advice nobody can take.
  const other = useBalances({
    chainId: otherChainId,
    enabled:
      isConnected &&
      !isLoading &&
      !isError &&
      !hasFunds &&
      otherChainId !== undefined &&
      !isMiniPay,
  });
  const otherTop = highestValue(other.balances);

  if (!isConnected || !address) return null;

  const topSymbol = highestValue(balances)?.symbol ?? null;

  return (
    <Card className="w-full max-w-md p-5 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="heading-sub text-[10px]">
          Wallet · {chainLabel(chainId).toLowerCase()}
        </p>
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
        ) : !hasFunds ? (
          <div className="flex flex-col gap-1.5">
            <NativeChip
              symbol={native.symbol}
              value={native.value}
              decimals={native.decimals}
              loading={nativeLoading}
            />
            <span className="text-xs font-sans text-muted-foreground">
              No payable balance on {chainLabel(chainId)}.
            </span>
            {otherTop && otherChainId !== undefined && (
              <span className="text-xs font-sans text-muted-foreground">
                You have{' '}
                <span className="font-mono text-money text-foreground">
                  {otherTop.symbol}{' '}
                  {Number(formatUnits(otherTop.balance, otherTop.decimals)).toFixed(2)}
                </span>{' '}
                on {chainLabel(otherChainId)} — open the wallet menu to switch.
              </span>
            )}
          </div>
        ) : (
          <>
            {balances.map((b) => {
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
            })}
            <NativeChip
              symbol={native.symbol}
              value={native.value}
              decimals={native.decimals}
              loading={nativeLoading}
            />
          </>
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
