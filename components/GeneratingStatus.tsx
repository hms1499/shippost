'use client';

import { motion } from 'framer-motion';
import {
  Search,
  LineChart,
  Check,
  X,
  Loader2,
  Receipt,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { InkDivider } from './InkDivider';
import { IllumQuill, IllumShield } from './IllumIcons';
import type { ThreadGenerationState } from '@/hooks/useThreadGeneration';
import type { StepId } from '@/lib/pipeline/types';

type StepIcon = React.ComponentType<{ size?: number; className?: string }>;

const STEP_META: Record<StepId, { label: string; Icon: StepIcon; budget: string }> = {
  serper: { label: 'Searching news', Icon: Search, budget: '$0.001' },
  coingecko: { label: 'Fetching market data', Icon: LineChart, budget: '$0.000' },
  groq: { label: 'Writing thread', Icon: IllumQuill, budget: '$0.001' },
  factCheck: { label: 'Fact-checking', Icon: IllumShield, budget: '$0.001' },
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
  if (status === 'settled')
    return <Check size={14} className="text-primary" aria-label="settled" />;
  if (status === 'running')
    return (
      <Loader2
        size={14}
        className="animate-spin text-[hsl(var(--ink-faded))]"
        aria-label="running"
      />
    );
  if (status === 'failed')
    return <X size={14} className="text-destructive" aria-label="failed" />;
  return <span className="text-[hsl(var(--ink-faded))]">·</span>;
}

/**
 * Reads like a Renaissance accounting ledger entry: italic title, leader-dot
 * rows, sepia ticks. The cost column uses tabular monospace so columns align.
 */
export function GeneratingStatus({
  gen,
  payTxHash,
  threadId,
  chainExplorerBase,
  agentWalletAddress,
}: Props) {
  const groqStep = gen.steps.groq;

  return (
    <Card ornament className="w-full max-w-md p-6 flex flex-col gap-4">
      <div>
        <p className="heading-sub text-[10px]">In Progress · Folio II</p>
        <h2 className="font-serif italic text-2xl mt-1">Calligraphing your thread…</h2>
      </div>

      <ul className="text-sm flex flex-col gap-2.5">
        <LedgerRow
          label="Payment confirmed"
          Icon={Receipt}
          right={
            payTxHash ? (
              <Check size={14} className="text-primary" aria-label="confirmed" />
            ) : (
              <Loader2
                size={14}
                className="animate-spin text-[hsl(var(--ink-faded))]"
                aria-label="pending"
              />
            )
          }
          budget="—"
        />

        {ORDER.map((id) => {
          const meta = STEP_META[id];
          const step = gen.steps[id];
          if (step.status === 'pending') return null;
          return (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <LedgerRow
                label={meta.label}
                Icon={meta.Icon}
                right={<StatusIcon status={step.status} />}
                budget={
                  step.costAmount
                    ? `$${step.costAmount} ${step.tokenSymbol ?? ''}`
                    : meta.budget
                }
              />
            </motion.div>
          );
        })}
      </ul>

      {groqStep.status === 'failed' && groqStep.error && (
        <p className="text-xs text-destructive italic">
          Step failed: {groqStep.error}
        </p>
      )}

      {gen.totalCostUsd && (
        <>
          <InkDivider />
          <p className="text-xs italic text-muted-foreground">
            Agent spent{' '}
            <span className="font-mono not-italic">${gen.totalCostUsd}</span>{' '}
            calligraphing this folio.
          </p>
        </>
      )}

      <div className="flex flex-col gap-1 text-xs">
        {payTxHash && (
          <a
            className="text-primary"
            href={`${chainExplorerBase}/tx/${payTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View pay tx →
          </a>
        )}
        {gen.steps.serper.txHash && (
          <a
            className="text-primary"
            href={`${chainExplorerBase}/tx/${gen.steps.serper.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View Serper x402 settlement →
          </a>
        )}
        {groqStep.txHash && (
          <a
            className="text-primary"
            href={`${chainExplorerBase}/tx/${groqStep.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View Groq x402 settlement →
          </a>
        )}
        {gen.steps.factCheck.txHash && (
          <a
            className="text-primary"
            href={`${chainExplorerBase}/tx/${gen.steps.factCheck.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View fact-check x402 settlement →
          </a>
        )}
        <a
          className="text-muted-foreground"
          href={`${chainExplorerBase}/address/${agentWalletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Agent wallet on explorer →
        </a>
      </div>

      {threadId !== null && (
        <p className="heading-sub text-[10px]">
          Thread № <span className="font-mono">{threadId.toString()}</span>
        </p>
      )}

      {gen.fatal && (
        <p className="text-sm text-destructive italic">
          Pipeline failed: {gen.fatal}
        </p>
      )}
    </Card>
  );
}

interface RowProps {
  label: string;
  Icon: StepIcon;
  right: React.ReactNode;
  budget: string;
}

function LedgerRow({ label, Icon, right, budget }: RowProps) {
  return (
    <li className="flex items-baseline gap-3 text-sm">
      <Icon
        size={14}
        className="self-center text-[hsl(var(--ink-faded))] shrink-0"
        aria-hidden
      />
      <span className="italic">{label}</span>
      <span
        className="flex-1 self-center border-b border-dotted border-[hsl(var(--ink-faded))] mx-1 mt-2 opacity-60"
        aria-hidden
      />
      <span className="font-mono text-[11px] text-[hsl(var(--ink-faded))]">
        {budget}
      </span>
      <span className="w-4 text-right">{right}</span>
    </li>
  );
}
