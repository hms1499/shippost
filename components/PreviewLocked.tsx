'use client';

import { Lock, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { THREAD_PRICE_LABEL } from '@/lib/tokens';
import { PayContext } from '@/components/PayContext';

interface Props {
  firstTweet: string;
  lockedCount: number;
  onUnlock: () => void;
  onRegenerate: () => void;
  regenerating: boolean;
  /** null only if the payment token could not be resolved; the line is then omitted. */
  tokenSymbol: string | null;
  /**
   * False when the connected wallet cannot cover the on-chain price. Optional
   * so the default stays "let them try" — a missing answer must never disable
   * the only button that earns money.
   */
  canPay?: boolean;
  /**
   * The price read off the chain, already formatted. THREAD_PRICE_LABEL is the
   * fallback for the frames before that read lands — it is a local constant,
   * and on prod Celo it names $0.10 while the contract charges $0.05. This is
   * the screen where the user agrees to pay, so it must not be the one guessing.
   */
  priceLabel?: string;
  onChangeChain?: () => void;
}

export function PreviewLocked({
  firstTweet,
  lockedCount,
  onUnlock,
  onRegenerate,
  regenerating,
  tokenSymbol,
  canPay,
  priceLabel,
  onChangeChain,
}: Props) {
  const price = priceLabel ?? THREAD_PRICE_LABEL;
  // lockedCount is "the rest"; the full thread is that plus the opening tweet.
  const totalTweets = Math.max(lockedCount, 0) + 1;
  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="heading-sub text-[10px]">Sample · First tweet free</p>
        <p className="text-sm font-sans text-muted-foreground leading-snug">
          A free taste of the opening. Pay <span className="font-mono text-money">{price}</span> to
          generate your full thread — freshly written and fact-checked.
        </p>
      </div>

      <Card className="p-4">
        <p className="whitespace-pre-wrap font-sans text-sm">{firstTweet}</p>
      </Card>

      <div className="relative flex flex-col gap-2" aria-hidden>
        {Array.from({ length: Math.min(Math.max(lockedCount, 0), 4) }).map((_, i) => (
          <Card key={i} className="p-4 select-none border-l-2 border-l-money">
            <div className="h-3 w-3/4 rounded bg-muted-foreground/25 blur-[1.5px]" />
            <div className="mt-2 h-3 w-1/2 rounded bg-muted-foreground/20 blur-[1.5px]" />
          </Card>
        ))}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="flex items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 py-1 text-xs font-mono text-muted-foreground">
            <Lock size={11} className="text-money" aria-hidden />
            unlocks after payment · ≈ {totalTweets} {totalTweets === 1 ? 'tweet' : 'tweets'}
          </span>
        </div>
      </div>

      <Button onClick={onUnlock} disabled={canPay === false}>
        Generate full thread · {price}
      </Button>

      {canPay === false && tokenSymbol && (
        <p className="text-xs font-sans text-muted-foreground leading-snug">
          Not enough {tokenSymbol} to unlock. Top up your wallet, then try again
          — nothing has been charged.
        </p>
      )}

      {tokenSymbol && <PayContext symbol={tokenSymbol} onChange={onChangeChain} />}

      {/* Placed at the moment of hesitation — which is exactly why it must not
          overstate. This said "within 24h" until 2026-09-01: refunds are drained
          by hand, and the on-chain refund() reverts while the contract reserve is
          empty, so no turnaround was ever backed by anything. State the promise
          that IS kept (a failed run is refundable) and how it arrives. */}
      <p className="text-center font-mono text-[11px] text-muted-foreground -mt-0.5">
        if the run fails · full refund · sent by hand
      </p>

      <p className="text-xs font-sans text-muted-foreground text-center leading-snug">
        Generated fresh, so the final wording may differ from this sample.
      </p>

      <button
        type="button"
        onClick={onRegenerate}
        disabled={regenerating}
        className="self-center inline-flex items-center justify-center gap-1.5 min-h-9 px-2 rounded font-mono text-[11px] text-muted-foreground hover:text-primary active:bg-primary/10 transition-colors disabled:opacity-50"
      >
        <RefreshCw size={11} className={regenerating ? 'animate-spin' : ''} aria-hidden />
        {regenerating ? 'Regenerating…' : 'Regenerate sample'}
      </button>
    </section>
  );
}
