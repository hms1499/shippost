'use client';

import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { haptic } from '@/lib/haptics';
import { buildReceiptText, settledCalls, agentProfitUsd } from '@/lib/receiptText';
import { explorerBase as explorerBaseFor } from '@/lib/chains';
import type { StepState } from '@/lib/threadGeneration';
import type { StepId } from '@/lib/pipeline/types';

interface Props {
  threadId: bigint | null;
  paidAmountUsd: string;
  agentSpentUsd: string;
  tokenSymbol: string;
  payTxHash: string | null;
  steps: Record<StepId, StepState>;
  agentWalletAddress: string;
  explorerBase: string;
  onWriteAnother: () => void;
  onReceiptCopied?: () => void;
}

/**
 * The machine prints a receipt. Thermal-print treatment on the house tokens:
 * centered asterisk header, dashed tear-lines between sections, leader-dot
 * ledger rows, perforated bottom edge. The per-call x402 rows are the point —
 * on-chain proof, one tx link each, that the agent spent real money.
 */
export function PostShareScreen({
  threadId,
  paidAmountUsd,
  agentSpentUsd,
  tokenSymbol,
  payTxHash,
  steps,
  agentWalletAddress,
  explorerBase,
  onWriteAnother,
  onReceiptCopied,
}: Props) {
  const reduced = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  // Stamped once when the receipt renders; post-share is reached client-side
  // only, so there is no SSR mismatch to worry about.
  const [printedAt] = useState(() => {
    const d = new Date();
    return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} utc`;
  });

  const paid = Number(paidAmountUsd);
  const agentShare = (paid * 0.5).toFixed(3);
  const treasuryShare = (paid * 0.4).toFixed(3);
  const reserveShare = (paid * 0.1).toFixed(3);
  const calls = settledCalls(steps);

  async function copyReceipt() {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(
        buildReceiptText({
          threadId,
          paidAmountUsd,
          tokenSymbol,
          agentSpentUsd,
          steps,
          payTxHash,
          explorerBase,
          agentWalletAddress,
        }),
      );
      setCopied(true);
      haptic('success');
      onReceiptCopied?.();
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError('Clipboard blocked — screenshot the receipt instead.');
    }
  }

  return (
    <section className="w-full max-w-md flex flex-col gap-4">
      <motion.div
        initial={reduced ? false : { clipPath: 'inset(0 0 100% 0)' }}
        animate={{ clipPath: 'inset(0 0 0% 0)' }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      >
        <div className="border border-b-0 border-border bg-card rounded-t-md px-5 pt-5 pb-4 flex flex-col gap-3">
          <div className="flex flex-col gap-0.5 text-center">
            <p className="heading-sub text-[10px] tracking-[0.35em]">· · coinop · ·</p>
            <p className="font-mono text-xs text-muted-foreground">
              receipt{threadId !== null ? ` #${threadId.toString()}` : ''} · {printedAt}
            </p>
          </div>

          <TearLine />

          <p className="heading-sub text-[10px]">Coin in</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            <LedgerLine
              left="you paid"
              right={`$${paidAmountUsd} ${tokenSymbol}`}
              txHref={payTxHash ? `${explorerBase}/tx/${payTxHash}` : undefined}
              bold
            />
          </ul>

          <TearLine />

          <p className="heading-sub text-[10px]">Split</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            <LedgerLine left="agent wallet · 50%" right={`$${agentShare}`} />
            <LedgerLine left="treasury · 40%" right={`$${treasuryShare}`} />
            <LedgerLine left="reserve · 10%" right={`$${reserveShare}`} />
          </ul>

          <TearLine />

          <p className="heading-sub text-[10px]">Agent spend · x402</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {calls.length > 0 ? (
              calls.map((c) => (
                <LedgerLine
                  key={c.id}
                  left={c.label}
                  right={`$${c.costAmount}`}
                  txHref={c.txHash ? `${c.chainId !== undefined ? explorerBaseFor(c.chainId) : explorerBase}/tx/${c.txHash}` : undefined}
                />
              ))
            ) : (
              <LedgerLine left="agent spend" right={`$${agentSpentUsd}`} />
            )}
            <LedgerLine
              left="agent p/l"
              right={agentProfitUsd(paidAmountUsd, agentSpentUsd)}
              accent
            />
          </ul>

          <p className="heading-sub text-[10px] text-center mt-1">
            * thank you · come again *
          </p>
        </div>
        <PerforatedEdge />
      </motion.div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={copyReceipt}>
          {copied ? (
            <>
              <Check size={14} aria-hidden /> Copied
            </>
          ) : (
            <>
              <Copy size={14} aria-hidden /> Copy receipt
            </>
          )}
        </Button>
        <Button className="flex-1" onClick={onWriteAnother}>
          Write another
        </Button>
      </div>
      {copyError && <p className="text-xs text-destructive">{copyError}</p>}

      <a
        className="text-xs text-muted-foreground self-center"
        href={`${explorerBase}/address/${agentWalletAddress}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        See the agent&apos;s full tx history →
      </a>
    </section>
  );
}

/** Dashed tear-line between receipt sections. */
function TearLine() {
  return <div className="border-t border-dashed border-border" aria-hidden />;
}

/** Zigzag bottom edge — the receipt is torn off the machine's printer. */
function PerforatedEdge() {
  return (
    <div
      aria-hidden
      className="h-2.5 w-full"
      style={{
        // Teeth are drawn in the border tone (not card) so the tear reads
        // against the near-black page even at this size.
        backgroundImage:
          'linear-gradient(45deg, hsl(var(--card)) 50%, transparent 50%), linear-gradient(-45deg, hsl(var(--card)) 50%, transparent 50%), linear-gradient(45deg, hsl(var(--border)) 50%, transparent 50%), linear-gradient(-45deg, hsl(var(--border)) 50%, transparent 50%)',
        backgroundSize: '14px 9px, 14px 9px, 14px 10px, 14px 10px',
        backgroundPosition: '0 0, 7px 0, 0 0, 7px 0',
        backgroundRepeat: 'repeat-x',
      }}
    />
  );
}

function LedgerLine({
  left,
  right,
  bold,
  accent,
  txHref,
}: {
  left: string;
  right: string;
  bold?: boolean;
  accent?: boolean;
  txHref?: string;
}) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        className={
          (accent ? 'text-primary ' : 'text-foreground ') +
          (bold ? 'font-semibold' : 'text-muted-foreground')
        }
      >
        {left}
      </span>
      <span
        className="flex-1 border-b border-dotted border-border mb-1 opacity-50"
        aria-hidden
      />
      <span
        className={
          (accent ? 'font-mono text-primary ' : 'font-mono text-money ') +
          (accent || bold ? 'font-semibold' : '')
        }
      >
        {right}
      </span>
      {txHref && (
        <a
          className="font-mono text-[11px] text-muted-foreground hover:text-primary transition-colors"
          href={txHref}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View transaction on explorer"
        >
          tx↗
        </a>
      )}
    </li>
  );
}
