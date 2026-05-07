'use client';

import { Wallet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InkDivider } from './InkDivider';

interface Props {
  paidAmountUsd: string;
  agentSpentUsd: string;
  tokenSymbol: string;
  payTxHash: string | null;
  agentWalletAddress: string;
  explorerBase: string;
  onWriteAnother: () => void;
}

/**
 * Reads like a Renaissance accounting ledger ("Liber Rationum"). Leader-dot
 * rows align costs in tabular monospace; the agent profit line is set in the
 * primary ink so it lifts off the page.
 */
export function PostShareScreen({
  paidAmountUsd,
  agentSpentUsd,
  tokenSymbol,
  payTxHash,
  agentWalletAddress,
  explorerBase,
  onWriteAnother,
}: Props) {
  const paid = Number(paidAmountUsd);
  const spent = Number(agentSpentUsd);
  const agentShare = (paid * 0.5).toFixed(3);
  const treasuryShare = (paid * 0.4).toFixed(3);
  const reserveShare = (paid * 0.1).toFixed(3);
  const agentProfit = (Number(agentShare) - spent).toFixed(3);

  return (
    <Card ornament className="w-full max-w-md p-6 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Wallet size={18} className="text-primary mt-1 shrink-0" aria-hidden />
        <div>
          <p className="heading-sub text-[10px]">Liber Rationum · The Account</p>
          <h3 className="font-serif italic text-xl leading-tight mt-0.5">
            Where did your {tokenSymbol} go?
          </h3>
        </div>
      </div>

      <ul className="flex flex-col gap-1.5 text-sm">
        <LedgerLine left="You paid" right={`$${paidAmountUsd}`} bold />

        <li className="my-1">
          <InkDivider />
        </li>

        <LedgerLine left="→ Agent wallet (50%)" right={`$${agentShare}`} />
        <LedgerLine left="→ Treasury (40%)" right={`$${treasuryShare}`} />
        <LedgerLine left="→ Reserve pool (10%)" right={`$${reserveShare}`} />

        <li className="my-1">
          <InkDivider />
        </li>

        <LedgerLine left="Agent spent on x402" right={`$${agentSpentUsd}`} />
        <LedgerLine
          left="Agent profit on this folio"
          right={`$${agentProfit}`}
          accent
        />
      </ul>

      <div className="flex flex-col gap-1 text-xs italic">
        {payTxHash && (
          <a
            className="text-primary not-italic"
            href={`${explorerBase}/tx/${payTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View payment on explorer →
          </a>
        )}
        <a
          className="text-muted-foreground not-italic"
          href={`${explorerBase}/address/${agentWalletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          See the agent&apos;s full tx history →
        </a>
      </div>

      <Button variant="outline" onClick={onWriteAnother}>
        Write another
      </Button>
    </Card>
  );
}

function LedgerLine({
  left,
  right,
  bold,
  accent,
}: {
  left: string;
  right: string;
  bold?: boolean;
  accent?: boolean;
}) {
  return (
    <li className="flex items-baseline gap-2">
      <span
        className={
          (accent ? 'text-primary italic ' : 'text-foreground ') +
          (bold ? 'font-semibold' : 'text-muted-foreground')
        }
      >
        {left}
      </span>
      <span
        className="flex-1 border-b border-dotted border-[hsl(var(--ink-faded))] mb-1 opacity-50"
        aria-hidden
      />
      <span
        className={
          'font-mono ' +
          (accent ? 'text-primary font-semibold' : 'text-foreground')
        }
      >
        {right}
      </span>
    </li>
  );
}
