'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import type { PaidRun } from '@/lib/paidRun';
import type { ResumeState } from '@/lib/resumeRun';
import { threadLabel } from '@/lib/threadLabel';

/**
 * Shown when the app reopens onto a run that was already paid for. The first
 * question a user has here is whether their money is gone, so the payment is
 * stated before anything else.
 *
 * The pay tx is deliberately NOT a link: this screen exists because the user
 * lost the app once already, and handing them a target="_blank" into an
 * external browser is how it happens again (audit finding 6.2).
 */
export function ResumingRun({
  run,
  state,
  onOpenHistory,
}: {
  run: PaidRun;
  state: ResumeState;
  onOpenHistory: () => void;
}) {
  const label = threadLabel({ mode: run.mode, topic: run.topic ?? null });

  return (
    <TerminalPanel title={`RESUMING RUN #${run.threadId}`} className="w-full max-w-md">
      <p className="text-sm font-mono text-money">
        paid · {run.tokenSymbol}
      </p>
      <p className="mt-1 text-[11px] font-mono text-muted-foreground break-all">
        tx {run.payTxHash}
      </p>
      {/* The reassurance is only true while the run might still deliver. Once
          the row says it failed, repeating it above the failure reads as the
          app not knowing what happened. */}
      <p className="mt-3 text-sm font-sans text-muted-foreground leading-snug">
        {state.state === 'failed'
          ? `${label} — this run is finished and it did not succeed.`
          : `${label} — the agent kept working while you were away. Nothing was lost and you will not be charged again.`}
      </p>

      {state.state === 'checking' && (
        <p className="mt-4 flex items-center gap-2 text-sm font-mono text-muted-foreground">
          <Loader2 size={14} className="animate-spin" aria-hidden />
          checking for your thread…
        </p>
      )}

      {/* Before this branch existed, a failed row bounced the user straight to
          the mode picker with no message and no refund path — and cleared the
          record on the way out. That is the population most likely to be owed
          money: their run is the one that failed. The refund card itself is
          rendered by HomeClient below this panel, the same as a live run. */}
      {state.state === 'failed' && (
        <p className="mt-4 text-sm font-sans text-muted-foreground leading-snug">
          {state.delivered
            ? 'It stopped partway, after writing part of the thread. What it produced is saved — open history to read it.'
            : 'Nothing was delivered, so nothing was generated against your payment.'}
        </p>
      )}

      {state.state === 'gone' && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm font-sans text-muted-foreground leading-snug">
            This is taking longer than expected. Your thread is not lost — it
            appears in history as soon as the agent finishes.
          </p>
          <Button variant="outline" onClick={onOpenHistory}>
            Open history
          </Button>
        </div>
      )}
    </TerminalPanel>
  );
}
