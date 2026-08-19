import type { Address, Hex } from 'viem';
import type { TokenSymbol } from '@/lib/tokens';

export type StepId = 'groq' | 'serper' | 'coingecko' | 'factCheck';

export interface StepMeta {
  id: StepId;
  label: string;
  estimatedCost: string;
}

export type PipelineEvent =
  // `paidAmountRaw` is the amount verifyPayment read back off the chain, in the
  // paid token's base units. The client had no way to know it and printed the
  // local THREAD_PRICE_USD constant instead — which on prod Celo names a price
  // nobody is charged. Optional so a stream can still start without it.
  | { type: 'started'; paidAmountRaw?: string }
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
  // The token the user paid in (verified on-chain in the route). The AgentWallet
  // spends its x402 micro-payments in this SAME token — the 50% split from
  // payForThread just credited it, so every thread self-funds. Hardcoding cUSD
  // here is what broke USDT/USDC-paid threads (wallet held USDT, pipeline spent
  // cUSD → "transfer amount exceeds balance").
  tokenSymbol: TokenSymbol;
  // Aborts when the route's internal deadline fires. Steps MUST check this
  // before any x402 settle so a timed-out (already-`fatal`, refundable) run
  // never spends from AgentWallet.
  signal?: AbortSignal;
}
