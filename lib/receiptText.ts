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
  chainId?: number;
}

// Settled steps in pipeline order. A settled step without a cost is a
// malformed event — drop it rather than printing a blank ledger row.
// Note: '0x0' is the no-hash sentinel for simulated/legacy settlement; it is
// filtered to undefined so the receipt does not include a dead explorer link.
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
      txHash: s.txHash !== '0x0' ? s.txHash : undefined,
      chainId: s.chainId,
    });
  }
  return calls;
}

/**
 * What the agent actually settled, summed from the steps themselves.
 *
 * The stream reports a total only on `done`, so a run that ended in `fatal`
 * has none — and the receipt used to fall back to a hardcoded '0.001', which
 * is a number nothing measured. These costs are the ones already shown on the
 * trace with their tx hashes beside them, so summing them is the one honest
 * answer available for a run that stopped partway.
 */
export function settledCostTotal(steps: Record<StepId, StepState>): string {
  let sum = 0;
  for (const call of settledCalls(steps)) {
    const c = Number(call.costAmount);
    if (Number.isFinite(c)) sum += c;
  }
  return sum.toFixed(3);
}

/**
 * What the agent kept, minus what it spent.
 *
 * Takes the agent's SHARE, not the price: it used to recompute the share as
 * `paid * 0.5`, which is the same floating-point split the receipt body had and
 * disagrees with the contract's integer division on any amount that does not
 * divide evenly. Callers pass the share from `splitPaidAmount`.
 */
export function agentProfitUsd(agentShareUsd: string, agentSpentUsd: string): string {
  const share = Number(agentShareUsd);
  const spent = Number(agentSpentUsd);
  if (!Number.isFinite(share) || !Number.isFinite(spent)) return '0.000';
  const profit = share - spent;
  return `${profit >= 0 ? '+' : '-'}$${Math.abs(profit).toFixed(3)}`;
}

export interface ReceiptInput {
  threadId: bigint | null;
  paidAmountUsd: string;
  /** The agent's exact share, from splitPaidAmount — never paid * 0.5. */
  agentShareUsd: string;
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
  lines.push(row('agent p/l', agentProfitUsd(input.agentShareUsd, input.agentSpentUsd)));
  if (input.payTxHash) {
    lines.push(row('payment tx', `${input.explorerBase}/tx/${input.payTxHash}`));
  }
  lines.push(row('machine', `${input.explorerBase}/address/${input.agentWalletAddress}`));
  return lines.join('\n');
}
