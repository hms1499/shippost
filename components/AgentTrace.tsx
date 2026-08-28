'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, X, Loader2, Lock } from 'lucide-react';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { explorerBase } from '@/lib/chains';
import { THREAD_PRICE_LABEL } from '@/lib/tokens';
import { appendTraceLines, type TraceLine } from '@/lib/traceLog';
import { MODE_B_STEPS } from '@/lib/pipeline/stepPlan';
import type { ThreadGenerationState } from '@/lib/threadGeneration';
import type { StepId } from '@/lib/pipeline/types';
import type { PayStatus } from '@/lib/usePayForThread';

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
  /**
   * What this thread actually cost, read off the chain and formatted. Falls
   * back to THREAD_PRICE_LABEL, which is a local constant — on prod Celo it
   * names $0.10 while the contract charges $0.05, so the fallback is for the
   * frames before `started` lands and for the canned demo, nothing else.
   */
  paidAmountLabel?: string;
  /**
   * The steps this mode will attempt, from stepPlanFor(). Supplies the
   * denominator: the stepper used to render only the steps that had already
   * started, so someone who had just paid could see what was happening but
   * never how much of it was left. Defaults to the longer plan — a denominator
   * that grows mid-run reads as a broken progress bar.
   */
  plan?: readonly StepId[];
  /** Canned landing replay — no fake thread id, no explorer links. */
  demo?: boolean;
}

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function totalSpent(gen: ThreadGenerationState): string {
  if (gen.totalCostUsd) return gen.totalCostUsd;
  // Every settled step, not just the ones on this mode's plan: the total is a
  // record of money that actually left the wallet, so it must not be filtered
  // by what we expected to run.
  let sum = 0;
  for (const id of Object.keys(gen.steps) as StepId[]) {
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
  paidAmountLabel,
  plan = MODE_B_STEPS,
  demo = false,
}: Props) {
  const reduced = useReducedMotion();
  const [lines, setLines] = useState<TraceLine[]>([]);
  const [elapsed, setElapsed] = useState(0);
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
    const el = logRef.current;
    if (!el) return;
    // Every new line used to yank the window down, which is exactly when the
    // user is trying to read the line above it. `behavior` is a scrollTo
    // option, not the scroll-behavior CSS property, so the global
    // prefers-reduced-motion rule cannot reach it — honour the setting here.
    el.scrollTo({ top: el.scrollHeight, behavior: reduced ? 'auto' : 'smooth' });
  }, [lines, reduced]);

  const running = !gen.isDone && !gen.fatal;

  // Wall clock, started when this panel mounts — which is the moment the user
  // taps pay, not the later moment the stream says `started`. The wait they are
  // asking about begins at the tap. A clock over the canned replay would be
  // timing nothing, so the demo has none.
  useEffect(() => {
    if (demo || !running) return;
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [demo, running]);

  // A soft-failed step is finished, not missing: it resolves its cell and must
  // count, or the run would appear to stall on a step that already gave up.
  const resolved = plan.filter((id) => {
    const st = gen.steps[id].status;
    return st === 'settled' || st === 'failed';
  }).length;
  const current = Math.min(resolved + 1, plan.length);
  const groq = gen.steps.groq;
  // Nothing was paid in the canned replay, so it must not print a price.
  const paidLabel = demo ? null : paidAmountLabel ?? THREAD_PRICE_LABEL;
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
        {/* The user's price leads. This slot used to show only SPENT — the
            agent's x402 outlay — so the biggest money number on the screen
            right after someone paid was the one they were not charged. */}
        <span className="flex items-baseline gap-2 normal-case tracking-normal font-mono">
          {paidLabel && <span className="text-money">PAID {paidLabel}</span>}
          <span className="text-muted-foreground">agent ${totalSpent(gen)}</span>
        </span>
      </div>

      {/* How much longer. Not an ETA — nothing here measures one, and a made-up
          number on the screen that just took the user's money is worse than
          none. A visible denominator plus a running clock is what can be said
          honestly. */}
      {running && (
        <div className="flex items-center justify-between mb-2 font-mono text-[10px] text-muted-foreground">
          <span aria-live="polite">
            step {current} of {plan.length}
          </span>
          {!demo && <span aria-hidden>{mmss(elapsed)} elapsed</span>}
        </div>
      )}

      {/* Layer 1 — pipeline stepper */}
      <div className="flex gap-1.5 mb-3" role="list" aria-label="pipeline steps">
        {plan.map((id) => {
          const s = gen.steps[id];
          const tone =
            s.status === 'settled'
              ? 'border-primary/60 text-primary bg-primary/10'
              : s.status === 'running'
                ? 'border-money/60 text-money bg-money/10'
                : s.status === 'failed'
                  ? 'border-destructive/60 text-destructive bg-destructive/10'
                  : 'border-border text-muted-foreground/50';
          // A cell going pending → running → settled is the agent spending the
          // user's money, and it used to snap between states with no transition
          // at all, while the decorative digit roll on the landing page got a
          // 420ms cubic-bezier. Colour only: size and position must not move,
          // or the four cells would jitter as each one resolves.
          const cell = `flex-1 rounded-md border px-1 py-1.5 text-center text-[10px] font-mono transition-colors duration-300 ${tone}`;
          const body = (
            <>
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
                {s.status === 'pending' && '·'}
              </div>
            </>
          );
          // A settled cell already measures 67x48 — comfortably the largest
          // thing on this panel that maps 1:1 to a transaction. The only way to
          // reach that tx used to be the 66x18 `tx:` link buried in the
          // scrolling log, so the cell now carries the same link at a size a
          // thumb can actually land on.
          return s.txHash && !demo ? (
            <a
              key={id}
              role="listitem"
              href={`${chainExplorerBase}/tx/${s.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${CELL_LABEL[id]} settlement on explorer`}
              className={`${cell} no-underline active:bg-primary/20`}
            >
              {body}
            </a>
          ) : (
            <div key={id} role="listitem" className={cell}>
              {body}
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
        <LogRow glyph={payTxHash ? 'ok' : payStatus === 'error' ? 'fail' : 'run'} text={payLabel} txHash={payTxHash ?? undefined} explorer={chainExplorerBase} amount={payTxHash ? paidAmountLabel ?? THREAD_PRICE_LABEL : undefined} />
        {/* verifyPayment reads the receipt back off the chain and retries a
            lagging node up to four times, so several seconds can pass between
            the payment landing and the first pipeline event. That is the worst
            moment to show a blank panel to someone who just spent money. */}
        {!demo && payTxHash && !gen.hasStarted && !gen.fatal && (
          <LogRow
            glyph="run"
            text="verifying payment on chain…"
            explorer={chainExplorerBase}
          />
        )}
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
            className="self-start inline-flex items-center min-h-9 px-1 -mx-1 rounded text-muted-foreground active:bg-primary/10 transition-colors"
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
        // 66x18 before: the smallest control in the app, in a scrolling log, on
        // the screen someone stares at right after paying. `-my-2` grows the hit
        // box to the repo's 36px nib floor without growing the row, and log rows
        // sit at least 36px apart, so neighbouring boxes meet but never overlap.
        <a
          className="inline-flex items-center min-h-9 px-1 -my-2 rounded text-muted-foreground/70 shrink-0 no-underline hover:text-primary active:bg-primary/10 transition-colors"
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
