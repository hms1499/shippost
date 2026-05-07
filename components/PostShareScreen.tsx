'use client';

import { Wallet } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Props {
  paidAmountUsd: string;
  agentSpentUsd: string;
  tokenSymbol: string;
  payTxHash: string | null;
  agentWalletAddress: string;
  explorerBase: string;
  onWriteAnother: () => void;
}

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
    <Card className="w-full max-w-md p-4 flex flex-col gap-3">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Wallet size={16} className="text-primary" aria-hidden />
        Where did your {tokenSymbol} go?
      </h3>

      <ul className="text-xs flex flex-col gap-1 font-mono">
        <li className="flex justify-between">
          <span>You paid</span>
          <span>${paidAmountUsd}</span>
        </li>
        <li className="flex justify-between text-muted-foreground">
          <span>→ Agent wallet (50%)</span>
          <span>${agentShare}</span>
        </li>
        <li className="flex justify-between text-muted-foreground">
          <span>→ Treasury (40%)</span>
          <span>${treasuryShare}</span>
        </li>
        <li className="flex justify-between text-muted-foreground">
          <span>→ Reserve pool (10%)</span>
          <span>${reserveShare}</span>
        </li>
        <li className="flex justify-between pt-1 border-t border-border">
          <span>Agent spent on x402</span>
          <span>${agentSpentUsd}</span>
        </li>
        <li className="flex justify-between text-primary">
          <span>Agent profit on this thread</span>
          <span>${agentProfit}</span>
        </li>
      </ul>

      <div className="flex flex-col gap-1 text-xs">
        {payTxHash && (
          <a
            className="text-primary underline"
            href={`${explorerBase}/tx/${payTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            View payment on explorer →
          </a>
        )}
        <a
          className="text-muted-foreground underline"
          href={`${explorerBase}/address/${agentWalletAddress}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          See the agent&apos;s full tx history →
        </a>
      </div>

      <Button variant="outline" onClick={onWriteAnother}>
        Write another →
      </Button>
    </Card>
  );
}
