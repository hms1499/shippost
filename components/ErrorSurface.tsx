'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useCopy } from '@/lib/useCopy';
import { REFUND_MANUAL_NOTE } from '@/lib/refundCopy';

export type ErrorKind =
  | 'approve-failed'
  | 'pay-failed'
  // The wallet never got as far as a signing sheet.
  | 'wallet-unavailable'
  // The pay tx was signed but its outcome is unknown — the one case where
  // retrying could charge twice.
  | 'pay-unconfirmed'
  | 'partial'
  | 'full-fail'
  // Preflight said the agent cannot settle, so we stopped before the wallet
  // sheet opened. These three are the only kinds where nothing was charged and
  // nothing was attempted — the copy has to say so, because the user tapped a
  // button that normally costs money.
  | 'spend-paused'
  | 'spend-gas'
  | 'spend-cap'
  | 'cap-hit'
  // The SSE connection dropped. Not a failure — the run continues server-side.
  | 'connection-lost'
  // The payment landed but /api/generate/stream refused to start the run (402
  // unverified, 409 replay, 503 could-not-record). For 402/503 no thread row
  // was ever written, so the ordinary refund button cannot work — it answers
  // `thread not found`. The pay tx is the only handle the user has left.
  | 'run-not-started';

export type RefundRequestStatus = 'idle' | 'sending' | 'sent' | 'error';

interface Props {
  kind: ErrorKind;
  onRetry?: () => void;
  onRefundRequest?: () => void;
  refundStatus?: RefundRequestStatus;
  refundError?: string | null;
  /**
   * The wallet's own words. A payment that fails inside the MiniPay webview
   * leaves no server-side trace, so this string is the only evidence of what
   * went wrong — show it verbatim and make it copyable rather than replacing
   * it with reassuring copy.
   */
  detail?: string | null;
  /**
   * The payment transaction, shown copyable on `run-not-started`. When no
   * thread row exists this hash is the user's entire claim, so it has to be
   * on screen and copyable — not left in a wallet history they have to dig for.
   */
  payTxHash?: string | null;
}

const COPY: Record<
  ErrorKind,
  { title: string; body: string; primary?: string }
> = {
  // Covers a deliberate rejection and a wallet-side error alike: the phase is
  // known, the reason is not, so the copy must not accuse the user of
  // cancelling something the wallet may have failed on its own.
  'approve-failed': {
    title: 'Approval did not go through',
    body: 'The one-time token approval never completed, so nothing was charged. You can retry safely.',
    primary: 'Try again',
  },
  'pay-failed': {
    title: 'Payment failed',
    body: 'The pay transaction did not go through. No funds moved. You can retry safely.',
    primary: 'Try again',
  },
  'wallet-unavailable': {
    title: 'Wallet did not respond',
    body: 'Your wallet never opened the payment, so nothing was sent and nothing was charged. Reopening CoinOp from MiniPay usually clears this.',
    primary: 'Try again',
  },
  'pay-unconfirmed': {
    title: 'Payment not confirmed',
    body: "We couldn't confirm your payment. Don't pay again yet — check your wallet history first, and use Recover thread if the payment did land.",
    primary: 'Try again',
  },
  // Deliberately NOT auto-queued: the nightly sweep only refunds runs that
  // delivered nothing (tweets IS NULL, lib/agent/reconcile.ts). A degraded
  // thread is still a delivery, so whether it was worth the price is the user's
  // call — which means the copy must not imply someone else is handling it.
  partial: {
    title: 'Partial output',
    body: 'One of the AI steps failed, so you paid full price for a thread built without it. Tap below to request a partial refund — this one is not queued for you.',
    primary: 'Request a partial refund',
  },
  // "All steps failed" was the old copy and was usually false: the common shape
  // is the soft steps settling and the hard Groq step throwing.
  'full-fail': {
    title: 'Generation failed',
    body: "The thread couldn't be generated and nothing was delivered, so this run is fully refundable.",
    primary: 'Request refund now',
  },
  'cap-hit': {
    title: 'Agent paused — back tomorrow',
    body: "Today's agent budget is spent, so this thread couldn't be generated. New generations resume at midnight UTC — and since you paid for nothing, this run is fully refundable.",
    primary: 'Request refund now',
  },
  'spend-paused': {
    title: 'Agent paused for maintenance',
    body: 'The agent is paused right now, so it cannot generate this thread. You have not been charged — nothing left your wallet.',
    primary: 'Try again',
  },
  'spend-gas': {
    title: 'Agent temporarily offline',
    body: "The agent can't post transactions right now. We stopped before charging you — nothing left your wallet.",
    primary: 'Try again',
  },
  'spend-cap': {
    title: 'Daily limit reached — back tomorrow',
    body: "Today's agent budget is spent, so it cannot generate this thread. New generations resume at midnight UTC. You have not been charged.",
    primary: 'Try again',
  },
  // The stream died on the client's side. It says nothing about the run, which
  // keeps going server-side — /api/generate/stream stops streaming, never
  // generating, when `emit` finds the controller closed. Claiming a failure
  // here would send the user to request a refund for a thread about to land.
  'connection-lost': {
    title: 'Connection lost',
    body: 'Your device lost the connection to this run — the agent keeps working regardless. The thread appears in history as soon as it finishes. Nothing was charged twice and nothing needs retrying.',
    primary: 'Open history',
  },
  'run-not-started': {
    title: 'Paid, but the run never started',
    body: 'Your payment is on chain — nothing was generated against it. Copy the transaction below and keep it: it is the proof of payment, and the only thing needed to get this refunded. Check history first in case the thread was already generated.',
    primary: 'Open history',
  },
};

export function ErrorSurface({
  kind,
  onRetry,
  onRefundRequest,
  refundStatus = 'idle',
  refundError,
  detail,
  payTxHash,
}: Props) {
  const c = COPY[kind];
  // Two independent instances: one confirmation must not light up the other's
  // button when both a reason and a tx hash are on screen.
  const { copied, failed: copyFailed, copy } = useCopy();
  const txCopy = useCopy();
  const isRefundKind =
    kind === 'partial' ||
    kind === 'full-fail' ||
    kind === 'cap-hit';
  // full-fail / cap-hit are total failures — the pipeline produced nothing, so
  // the nightly sweep queues these without the user doing anything. partial
  // still delivers the working part of the thread and is user-initiated only,
  // so it must not carry the same line.
  const isAutoRefundNoDelivery = kind === 'full-fail' || kind === 'cap-hit';
  const primary = isRefundKind ? onRefundRequest : onRetry;

  const buttonLabel = isRefundKind && refundStatus === 'sending'
    ? 'Sending…'
    : isRefundKind && refundStatus === 'sent'
      ? 'Refund request received ✓'
      : c.primary;
  const disabled = isRefundKind && (refundStatus === 'sending' || refundStatus === 'sent');

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3 border-destructive/50 bg-destructive/10">
      <h3 className="text-sm font-semibold font-mono">✗ {c.title}</h3>
      <p className="text-sm font-sans text-muted-foreground">{c.body}</p>
      {isAutoRefundNoDelivery && (
        <p className="text-xs font-sans text-muted-foreground">
          Queued for you by the nightly sweep — or tap below to queue it now. An
          operator sends every refund from the queue.
        </p>
      )}
      {payTxHash && (
        <div className="flex flex-col gap-1">
          <p className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            payment transaction
          </p>
          <p className="text-xs font-mono text-foreground/90 break-all select-text">
            {payTxHash}
          </p>
          <button
            type="button"
            onClick={() => txCopy.copy(payTxHash)}
            className="self-start inline-flex items-center min-h-9 px-1 -mx-1 rounded text-xs font-mono text-muted-foreground underline underline-offset-2 hover:text-primary active:bg-primary/10 transition-colors"
          >
            {txCopy.copied ? 'copied ✓' : txCopy.failed ? 'select the text above' : 'copy transaction'}
          </button>
        </div>
      )}
      {detail && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-mono text-muted-foreground break-words select-text">
            {detail}
          </p>
          <button
            type="button"
            onClick={() => copy(detail)}
            className="self-start inline-flex items-center min-h-9 px-1 -mx-1 rounded text-xs font-mono text-muted-foreground underline underline-offset-2 hover:text-primary active:bg-primary/10 transition-colors"
          >
            {copied ? 'copied ✓' : copyFailed ? 'select the text above' : 'copy error'}
          </button>
        </div>
      )}
      {buttonLabel && primary && (
        <Button variant="outline" onClick={primary} disabled={disabled}>
          {buttonLabel}
        </Button>
      )}
      {isRefundKind && refundStatus === 'sent' && (
        <p className="text-xs font-sans text-muted-foreground">{REFUND_MANUAL_NOTE}</p>
      )}
      {isRefundKind && refundStatus === 'error' && refundError && (
        <p className="text-xs font-sans text-destructive">{refundError}</p>
      )}
    </Card>
  );
}
