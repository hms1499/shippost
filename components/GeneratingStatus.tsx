'use client';

import { motion } from 'framer-motion';
import { Card } from '@/components/ui/card';
import type { ThreadGenerationState } from '@/hooks/useThreadGeneration';
import type { StepId } from '@/lib/pipeline/types';

const STEP_META: Record<StepId, { label: string; icon: string; budget: string }> = {
  groq: { label: 'Writing thread', icon: '✍️', budget: '$0.001' },
};

const ORDER: StepId[] = ['groq'];

interface Props {
  gen: ThreadGenerationState;
  payTxHash: string | null;
  threadId: bigint | null;
  chainExplorerBase: string;
  agentWalletAddress: string;
}

function statusIcon(s: string): string {
  if (s === 'settled') return '✓';
  if (s === 'running') return '⏳';
  if (s === 'failed') return '✕';
  return '—';
}

export function GeneratingStatus({
  gen,
  payTxHash,
  threadId,
  chainExplorerBase,
  agentWalletAddress,
}: Props) {
  const groqStep = gen.steps.groq;

  return (
    <Card className="w-full max-w-md p-4 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Generating your thread…</h2>

      <ul className="text-sm flex flex-col gap-2">
        <li className="flex items-center justify-between">
          <span>💸 Payment confirmed</span>
          <span className="font-mono text-xs">{payTxHash ? '✓' : '⏳'}</span>
        </li>

        {ORDER.map((id) => {
          const meta = STEP_META[id];
          const step = gen.steps[id];
          return (
            <motion.li
              key={id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-2"
            >
              <span>
                {meta.icon} {meta.label}
              </span>
              <span className="flex items-center gap-2 font-mono text-xs">
                {step.costAmount
                  ? `$${step.costAmount} ${step.tokenSymbol ?? ''}`
                  : meta.budget}
                <span className="min-w-[1ch] text-right">{statusIcon(step.status)}</span>
              </span>
            </motion.li>
          );
        })}
      </ul>

      {groqStep.status === 'failed' && groqStep.error && (
        <p className="text-xs text-destructive">Step failed: {groqStep.error}</p>
      )}

      {gen.totalCostUsd && (
        <p className="text-xs text-muted-foreground">
          Agent spent <span className="font-mono">${gen.totalCostUsd}</span> generating this thread
        </p>
      )}

      <div className="flex flex-col gap-1 text-xs">
        {payTxHash && (
          <a
            className="text-primary underline"
            href={`${chainExplorerBase}/tx/${payTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View pay tx →
          </a>
        )}
        {groqStep.txHash && (
          <a
            className="text-primary underline"
            href={`${chainExplorerBase}/tx/${groqStep.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View Groq x402 settlement →
          </a>
        )}
        <a
          className="text-muted-foreground underline"
          href={`${chainExplorerBase}/address/${agentWalletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Agent wallet on explorer →
        </a>
      </div>

      {threadId !== null && (
        <p className="text-xs text-muted-foreground">Thread #{threadId.toString()}</p>
      )}

      {gen.fatal && <p className="text-sm text-destructive">Pipeline failed: {gen.fatal}</p>}
    </Card>
  );
}
