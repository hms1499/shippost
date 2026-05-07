'use client';

import { motion } from 'framer-motion';
import {
  Search,
  LineChart,
  PenSquare,
  ShieldCheck,
  Check,
  X,
  Loader2,
  Receipt,
  type LucideIcon,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import type { ThreadGenerationState } from '@/hooks/useThreadGeneration';
import type { StepId } from '@/lib/pipeline/types';

const STEP_META: Record<StepId, { label: string; Icon: LucideIcon; budget: string }> = {
  serper: { label: 'Searching news', Icon: Search, budget: '$0.001' },
  coingecko: { label: 'Fetching market data', Icon: LineChart, budget: '$0.000' },
  groq: { label: 'Writing thread', Icon: PenSquare, budget: '$0.001' },
  factCheck: { label: 'Fact-checking', Icon: ShieldCheck, budget: '$0.001' },
};

const ORDER: StepId[] = ['serper', 'coingecko', 'groq', 'factCheck'];

interface Props {
  gen: ThreadGenerationState;
  payTxHash: string | null;
  threadId: bigint | null;
  chainExplorerBase: string;
  agentWalletAddress: string;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'settled') return <Check size={14} className="text-primary" aria-label="settled" />;
  if (status === 'running')
    return <Loader2 size={14} className="animate-spin text-muted-foreground" aria-label="running" />;
  if (status === 'failed') return <X size={14} className="text-destructive" aria-label="failed" />;
  return <span className="text-muted-foreground">—</span>;
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
          <span className="flex items-center gap-2">
            <Receipt size={16} className="text-muted-foreground" aria-hidden />
            Payment confirmed
          </span>
          <span className="font-mono text-xs">
            {payTxHash ? (
              <Check size={14} className="text-primary" aria-label="confirmed" />
            ) : (
              <Loader2 size={14} className="animate-spin text-muted-foreground" aria-label="pending" />
            )}
          </span>
        </li>

        {ORDER.map((id) => {
          const meta = STEP_META[id];
          const step = gen.steps[id];
          if (step.status === 'pending') return null;
          const { Icon } = meta;
          return (
            <motion.li
              key={id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center justify-between gap-2"
            >
              <span className="flex items-center gap-2">
                <Icon size={16} className="text-muted-foreground" aria-hidden />
                {meta.label}
              </span>
              <span className="flex items-center gap-2 font-mono text-xs">
                {step.costAmount
                  ? `$${step.costAmount} ${step.tokenSymbol ?? ''}`
                  : meta.budget}
                <span className="min-w-[1ch] text-right">
                  <StatusIcon status={step.status} />
                </span>
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
        {gen.steps.serper.txHash && (
          <a
            className="text-primary underline"
            href={`${chainExplorerBase}/tx/${gen.steps.serper.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View Serper x402 settlement →
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
        {gen.steps.factCheck.txHash && (
          <a
            className="text-primary underline"
            href={`${chainExplorerBase}/tx/${gen.steps.factCheck.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View fact-check x402 settlement →
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
