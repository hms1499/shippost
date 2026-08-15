'use client';

import { formatUnits } from 'viem';
import { Loader2 } from 'lucide-react';
import type { ChainOption } from '@/lib/chainChoice';

interface Props {
  options: ChainOption[];
  /** Chain currently being switched to, if any. */
  pendingChainId: number | null;
  /** One line from describeSwitchError, or null. */
  error: string | null;
  gasNoteFor: (chainId: number) => string | null;
  onSelect: (chainId: number) => void;
}

/**
 * "Which chain do you want to pay on", with the two facts that decide it:
 * what you hold there, and who pays the gas.
 *
 * Chains are told apart by uppercase mono type, never by colour — Coinbase
 * blue and Celo yellow would break the monochrome terminal theme.
 */
export function ChainPicker({
  options,
  pendingChainId,
  error,
  gasNoteFor,
  onSelect,
}: Props) {
  const busy = pendingChainId !== null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="heading-sub text-[10px]">Pay on</p>

      <div className="rounded-md border border-border divide-y divide-border overflow-hidden">
        {options.map((o) => {
          const pending = pendingChainId === o.chainId;
          const note = gasNoteFor(o.chainId);
          return (
            <button
              key={o.chainId}
              type="button"
              disabled={busy || o.isCurrent}
              onClick={() => onSelect(o.chainId)}
              aria-current={o.isCurrent}
              className={
                'w-full px-3 py-2.5 flex flex-col gap-1 text-left transition-colors ' +
                (o.isCurrent ? 'bg-[hsl(var(--primary)/0.08)] ' : 'hover:bg-muted/40 ') +
                (busy && !pending ? 'opacity-50 ' : '')
              }
            >
              <span className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2">
                  <span
                    className={
                      'w-1.5 h-1.5 rounded-full shrink-0 ' +
                      (o.isCurrent ? 'bg-primary' : 'border border-muted-foreground')
                    }
                    aria-hidden
                  />
                  <span className="heading-sub text-[10px] text-foreground">
                    {o.label.toUpperCase()}
                  </span>
                </span>

                {pending ? (
                  <span className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
                    <Loader2 size={10} className="animate-spin" aria-hidden />
                    switching…
                  </span>
                ) : (
                  note && (
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {note}
                    </span>
                  )
                )}
              </span>

              <span className="font-mono text-[11px] text-muted-foreground pl-3.5">
                {o.hasFailed
                  ? "couldn't read balances"
                  : o.isLoading
                    ? o.tokens.length === 0
                      ? '·····'
                      : o.tokens.map((t) => `${t.symbol} ·····`).join(' · ')
                    : o.tokens.length === 0
                      ? 'no tokens here'
                      : o.tokens
                          .map(
                            (t) =>
                              `${t.symbol} ${
                                t.balance === 0n
                                  ? '—'
                                  : Number(formatUnits(t.balance, t.decimals)).toFixed(2)
                              }`,
                          )
                          .join(' · ')}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="font-mono text-[11px] text-destructive leading-snug">{error}</p>
      )}
    </div>
  );
}
