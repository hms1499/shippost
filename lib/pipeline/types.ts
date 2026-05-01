import type { Address, Hex } from 'viem';

export type StepId = 'groq' | 'flux';

export interface StepMeta {
  id: StepId;
  label: string;
  estimatedCost: string;
}

export type PipelineEvent =
  | { type: 'step_started'; step: StepId }
  | { type: 'step_settled'; step: StepId; txHash: Hex; costAmount: string; tokenSymbol: 'cUSD' | 'USDT' | 'USDC' }
  | { type: 'step_output'; step: StepId; output: unknown }
  | { type: 'step_failed'; step: StepId; error: string }
  | { type: 'done'; totalCostUsd: string }
  | { type: 'fatal'; error: string };

export interface PipelineContext {
  chainId: number;
  threadId: bigint;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  agentWallet: Address;
}
