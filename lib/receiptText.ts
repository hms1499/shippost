// Pure builders for the post-run receipt: the per-call x402 ledger rows and
// the plain-text version users copy to paste into X/Telegram. Kept out of the
// component so the money math and formatting are unit-testable.

import type { StepState } from './threadGeneration';
import type { StepId } from './pipeline/types';

const STEP_ORDER: StepId[] = ['serper', 'coingecko', 'groq', 'factCheck'];
const STEP_LABEL: Record<StepId, string> = {
  serper: 'serper',
  coingecko: 'coingecko',
  groq: 'groq',
  factCheck: 'fact-check',
};

export interface X402Call {
  id: StepId;
  label: string;
  costAmount: string;
  tokenSymbol?: string;
  txHash?: string;
}

// Settled steps in pipeline order. A settled step without a cost is a
// malformed event — drop it rather than printing a blank ledger row.
export function settledCalls(steps: Record<StepId, StepState>): X402Call[] {
  const calls: X402Call[] = [];
  for (const id of STEP_ORDER) {
    const s = steps[id];
    if (s.status !== 'settled' || !s.costAmount) continue;
    calls.push({
      id,
      label: STEP_LABEL[id],
      costAmount: s.costAmount,
      tokenSymbol: s.tokenSymbol,
      txHash: s.txHash,
    });
  }
  return calls;
}

export function agentProfitUsd(paidAmountUsd: string, agentSpentUsd: string): string {
  const paid = Number(paidAmountUsd);
  const spent = Number(agentSpentUsd);
  if (!Number.isFinite(paid) || !Number.isFinite(spent)) return '0.000';
  const profit = paid * 0.5 - spent;
  return `${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toFixed(3)}`;
}

export interface ReceiptInput {
  threadId: bigint | null;
  paidAmountUsd: string;
  tokenSymbol: string;
  agentSpentUsd: string;
  steps: Record<StepId, StepState>;
  payTxHash: string | null;
  explorerBase: string;
  agentWalletAddress: string;
}

// Column-aligned so it reads as a receipt even in a plain-text paste.
function row(label: string, value: string): string {
  return `${label.padEnd(13)}${value}`;
}

export function buildReceiptText(input: ReceiptInput): string {
  const lines: string[] = [];
  lines.push(`COINOP · receipt${input.threadId !== null ? ` #${input.threadId}` : ''}`);
  lines.push(row('coin in', `$${input.paidAmountUsd} ${input.tokenSymbol}`));
  lines.push(row('agent spend', `$${input.agentSpentUsd} via x402`));
  for (const call of settledCalls(input.steps)) {
    lines.push(row(call.label, `$${call.costAmount}`));
  }
  lines.push(row('agent p/l', agentProfitUsd(input.paidAmountUsd, input.agentSpentUsd)));
  if (input.payTxHash) {
    lines.push(row('payment tx', `${input.explorerBase}/tx/${input.payTxHash}`));
  }
  lines.push(row('machine', `${input.explorerBase}/address/${input.agentWalletAddress}`));
  return lines.join('\n');
}
