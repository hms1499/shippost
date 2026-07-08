import type { Address, Hex } from 'viem';

export type StepId = 'groq' | 'serper' | 'coingecko' | 'factCheck';

export interface StepMeta {
  id: StepId;
  label: string;
  estimatedCost: string;
}

export type PipelineEvent =
  | { type: 'started' }
  | { type: 'step_started'; step: StepId }
  | { type: 'step_settled'; step: StepId; txHash: Hex; costAmount: string; tokenSymbol: 'cUSD' | 'USDT' | 'USDC'; chainId?: number }
  | { type: 'step_output'; step: StepId; output: unknown }
  | { type: 'step_failed'; step: StepId; error: string }
  | { type: 'done'; totalCostUsd: string }
  | { type: 'fatal'; error: string };

export interface PipelineContext {
  chainId: number;
  threadId: bigint;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  agentWallet: Address;
  // Aborts when the route's internal deadline fires. Steps MUST check this
  // before any x402 settle so a timed-out (already-`fatal`, refundable) run
  // never spends from AgentWallet.
  signal?: AbortSignal;
}
