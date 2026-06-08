'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export type ErrorKind =
  | 'insufficient'
  | 'approve-rejected'
  | 'pay-failed'
  | 'partial'
  | 'full-fail'
  | 'cap-hit';

export type RefundRequestStatus = 'idle' | 'sending' | 'sent' | 'error';

interface Props {
  kind: ErrorKind;
  onRetry?: () => void;
  onRefundRequest?: () => void;
  refundStatus?: RefundRequestStatus;
  refundError?: string | null;
}

const COPY: Record<
  ErrorKind,
  { title: string; body: string; primary?: string }
> = {
  insufficient: {
    title: 'Not enough balance',
    body: 'You need 0.05 of the selected token. Top up in MiniPay or pick another token above.',
    primary: 'Open MiniPay top-up',
  },
  'approve-rejected': {
    title: 'Approval cancelled',
    body: 'You rejected the approve step. No funds moved.',
    primary: 'Try again',
  },
  'pay-failed': {
    title: 'Payment failed',
    body: 'The pay transaction reverted. No funds moved. You can retry safely.',
    primary: 'Try again',
  },
  partial: {
    title: 'Partial output — partial refund queued',
    body: 'One of the AI steps failed. You get the working part of the thread. We will refund the failed step within 24h.',
    primary: 'Request refund now',
  },
  'full-fail': {
    title: 'Generation failed',
    body: 'All steps failed. A full refund will be sent automatically within 24h.',
    primary: 'Request refund now',
  },
  'cap-hit': {
    title: 'Agent paused — back tomorrow',
    body: "Today's agent budget is spent, so this thread couldn't be generated. New generations resume at midnight UTC — and since you paid for nothing, a full refund will be sent within 24h.",
    primary: 'Request refund now',
  },
};

export function ErrorSurface({
  kind,
  onRetry,
  onRefundRequest,
  refundStatus = 'idle',
  refundError,
}: Props) {
  const c = COPY[kind];
  const isRefundKind =
    kind === 'partial' ||
    kind === 'full-fail' ||
    kind === 'cap-hit';
  const primary = kind === 'insufficient'
    ? () => window.open('https://minipay.to', '_blank')
    : isRefundKind
      ? onRefundRequest
      : onRetry;

  const buttonLabel = isRefundKind && refundStatus === 'sending'
    ? 'Sending…'
    : isRefundKind && refundStatus === 'sent'
      ? 'Refund request received ✓'
      : c.primary;
  const disabled = isRefundKind && (refundStatus === 'sending' || refundStatus === 'sent');

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3 border-destructive/40">
      <h3 className="text-sm font-semibold">{c.title}</h3>
      <p className="text-sm text-muted-foreground">{c.body}</p>
      {buttonLabel && primary && (
        <Button variant="outline" onClick={primary} disabled={disabled}>
          {buttonLabel}
        </Button>
      )}
      {isRefundKind && refundStatus === 'sent' && (
        <p className="text-xs text-muted-foreground">Operator will process within 24h.</p>
      )}
      {isRefundKind && refundStatus === 'error' && refundError && (
        <p className="text-xs text-destructive">{refundError}</p>
      )}
    </Card>
  );
}
