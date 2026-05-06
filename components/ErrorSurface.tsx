'use client';

import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export type ErrorKind =
  | 'insufficient'
  | 'approve-rejected'
  | 'pay-failed'
  | 'partial'
  | 'full-fail'
  | 'cap-hit'
  | 'slow';

interface Props {
  kind: ErrorKind;
  onRetry?: () => void;
  onRefundRequest?: () => void;
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
    body: "Today's agent budget is spent. The app pauses new generations until midnight UTC.",
  },
  slow: {
    title: 'This is taking longer than usual',
    body: 'The pipeline is still running. You can cancel for a 50% refund.',
    primary: 'Cancel + refund 50%',
  },
};

export function ErrorSurface({ kind, onRetry, onRefundRequest }: Props) {
  const c = COPY[kind];
  const primary =
    kind === 'insufficient'
      ? () => window.open('https://minipay.to', '_blank')
      : kind === 'slow' || kind === 'partial' || kind === 'full-fail'
        ? onRefundRequest
        : onRetry;

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3 border-destructive/40">
      <h3 className="text-sm font-semibold">{c.title}</h3>
      <p className="text-sm text-muted-foreground">{c.body}</p>
      {c.primary && primary && (
        <Button variant="outline" onClick={primary}>
          {c.primary}
        </Button>
      )}
    </Card>
  );
}
