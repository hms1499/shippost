'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, X, Loader2, Lock } from 'lucide-react';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { explorerBase } from '@/lib/chains';
import { THREAD_PRICE_LABEL } from '@/lib/tokens';
import { appendTraceLines, type TraceLine } from '@/lib/traceLog';
import type { ThreadGenerationState } from '@/lib/threadGeneration';
import type { StepId } from '@/lib/pipeline/types';
import type { PayStatus } from '@/lib/usePayForThread';

const ORDER: StepId[] = ['serper', 'coingecko', 'groq', 'factCheck'];
const CELL_LABEL: Record<StepId, string> = {
  serper: 'SERPER',
  coingecko: 'GECKO',
  groq: 'GROQ',
  factCheck: 'FACT',
};

const PAY_LABEL: Record<PayStatus, string> = {
  idle: 'payment queued',
  approving: 'approving allowance…',
  paying: 'awaiting signature in wallet…',
  'waiting-confirmation': 'confirming on chain…',
  success: 'payment confirmed',
  error: 'payment failed',
};

interface Props {
  gen: ThreadGenerationState;
  payStatus?: PayStatus;
  payTxHash: string | null;
  threadId: bigint | null;
  chainExplorerBase: string;
  agentWalletAddress: string;
  /** Canned landing replay — no fake thread id, no explorer links. */
  demo?: boolean;
}

function totalSpent(gen: ThreadGenerationState): string {
  if (gen.totalCostUsd) return gen.totalCostUsd;
  let sum = 0;
  for (const id of ORDER) {
    const c = gen.steps[id].costAmount;
    if (c) sum += Number(c);
  }
  return sum.toFixed(3);
}

export function AgentTrace({
  gen,
  payStatus,
  payTxHash,
  threadId,
  chainExplorerBase,
  agentWalletAddress,
  demo = false,
}: Props) {
  const reduced = useReducedMotion();
  const [lines, setLines] = useState<TraceLine[]>([]);
  const prevRef = useRef<ThreadGenerationState | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev && prev !== gen) {
      setLines((ls) => appendTraceLines(ls, prev, gen));
    }
    prevRef.current = gen;
  }, [gen]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const activeSteps = ORDER.filter((id) => gen.steps[id].status !== 'pending');
  const groq = gen.steps.groq;
  const payLabel = demo
    ? 'demo · no payment'
    : payTxHash
      ? PAY_LABEL.success
      : payStatus
        ? PAY_LABEL[payStatus]
        : 'payment pending';

  return (
    <TerminalPanel className="w-full max-w-md" title={undefined}>
      {/* Header: thread id + running spend total (amber) */}
      <div className="flex items-center justify-between heading-sub text-[10px] mb-3">
        <span>
          {demo ? 'DEMO' : `THREAD${threadId !== null ? ` #${threadId.toString()}` : ''}`}
        </span>
        <span className="text-money normal-case tracking-normal font-mono">
          SPENT ${totalSpent(gen)}
        </span>
      </div>

      {/* Layer 1 — pipeline stepper */}
      <div className="flex gap-1.5 mb-3" role="list" aria-label="pipeline steps">
        {activeSteps.map((id) => {
          const s = gen.steps[id];
          const tone =
            s.status === 'settled'
              ? 'border-primary/60 text-primary bg-primary/10'
              : s.status === 'running'
                ? 'border-money/60 text-money bg-money/10'
                : 'border-destructive/60 text-destructive bg-destructive/10';
          return (
            <div
              key={id}
              role="listitem"
              className={`flex-1 rounded-md border px-1 py-1.5 text-center text-[10px] font-mono ${tone}`}
            >
              <div className="font-bold tracking-wider">{CELL_LABEL[id]}</div>
              <div className="mt-0.5">
                {s.status === 'settled' &&
                  (s.costAmount ? (
                    <>✓ <span className="text-money">${s.costAmount}</span></>
                  ) : (
                    '✓'
                  ))}
                {s.status === 'running' && '⣷ run'}
                {s.status === 'failed' && '✗ fail'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Layer 2 — log window */}
      <div
        ref={logRef}
        className="rounded-md border border-border bg-background/60 p-2.5 max-h-44 overflow-y-auto text-[11px] font-mono leading-relaxed"
        aria-live="polite"
      >
        <LogRow glyph={payTxHash ? 'ok' : payStatus === 'error' ? 'fail' : 'run'} text={payLabel} txHash={payTxHash ?? undefined} explorer={chainExplorerBase} amount={payTxHash ? THREAD_PRICE_LABEL : undefined} />
        {lines.map((l) => (
          <motion.div
            key={l.key}
            initial={reduced ? false : { opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2 }}
          >
            <LogRow glyph={l.glyph} text={l.text} amount={l.amount} txHash={l.txHash} explorer={l.chainId !== undefined ? explorerBase(l.chainId) : chainExplorerBase} />
          </motion.div>
        ))}
        {!gen.isDone && !gen.fatal && <span className="cursor-block ml-0.5" aria-hidden />}
      </div>

      {/* Layer 3 — tweet slots: locked while GROQ runs; content only ever
          arrives via step_output AFTER settle (backend invariant). */}
      {groq.status === 'running' && !gen.tweets && (
        <div className="mt-3 rounded-md border border-border border-l-2 border-l-money bg-card p-3">
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
            <Lock size={12} className="text-money" aria-hidden />
            drafting… tweets unlock when the x402 settle confirms
          </div>
        </div>
      )}

      {/* A fatal AFTER groq settled still has tweets — the deadline firing
          during fact-check is the usual shape. Claiming "nothing was delivered"
          there contradicted the partial card rendered right below this panel. */}
      {gen.fatal && (
        <p className="mt-3 text-xs font-mono text-destructive">
          ✗ pipeline fatal — {gen.fatal}.{' '}
          {gen.tweets
            ? 'Part of the thread was produced — a partial refund can be requested.'
            : 'Nothing was delivered; a refund is queued.'}
        </p>
      )}

      {!demo && (
        <div className="mt-3 flex flex-col gap-1 text-[11px] font-mono">
          <a
            className="text-muted-foreground"
            href={`${chainExplorerBase}/address/${agentWalletAddress}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            agent wallet on explorer →
          </a>
        </div>
      )}
    </TerminalPanel>
  );
}

function LogRow({
  glyph,
  text,
  amount,
  txHash,
  explorer,
}: {
  glyph: 'ok' | 'run' | 'fail' | 'info';
  text: string;
  amount?: string;
  txHash?: string;
  explorer: string;
}) {
  const mark =
    glyph === 'ok' ? (
      <Check size={11} className="inline text-primary" aria-label="ok" />
    ) : glyph === 'fail' ? (
      <X size={11} className="inline text-destructive" aria-label="failed" />
    ) : glyph === 'run' ? (
      <Loader2 size={11} className="inline animate-spin text-money" aria-label="running" />
    ) : (
      <span className="text-muted-foreground">·</span>
    );
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="w-3.5 shrink-0 text-center">{mark}</span>
      <span className="flex-1 text-foreground/90">{text}</span>
      {amount && <span className="text-money shrink-0">{amount}</span>}
      {txHash && (
        <a
          className="text-muted-foreground/70 shrink-0 no-underline hover:text-primary"
          href={`${explorer}/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          tx:{txHash.slice(0, 6)}…
        </a>
      )}
    </div>
  );
}
