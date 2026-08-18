import type { Address, Hex } from 'viem';
import { settleX402Call } from '@/lib/agent/orchestrator';
import { settlesSoftStepsOnChain } from '@/lib/chainPolicy';
import { X402_UNIT_COST_USD } from '@/lib/tokens';
import { throwIfAborted } from './abort';
import type { PipelineContext, PipelineEvent } from './types';

export type SoftStepId = 'serper' | 'factCheck';

// Shared Model-1 settle for soft steps. On Base this is a bookkeeping emit
// (tx 0x0, $0) — no executeX402Call. On Celo it still burns to the sink so
// the MiniApp demo stays on-chain. Groq is NOT routed through here.
export async function settleSoftStep(params: {
  ctx: PipelineContext;
  step: SoftStepId;
  serviceAddress: Address;
  emit: (e: PipelineEvent) => void;
}): Promise<void> {
  throwIfAborted(params.ctx.signal);

  if (!settlesSoftStepsOnChain(params.ctx.chainId)) {
    params.emit({
      type: 'step_settled',
      step: params.step,
      txHash: '0x0' as Hex,
      costAmount: '0.000',
      tokenSymbol: params.ctx.tokenSymbol,
    });
    return;
  }

  try {
    const txHash = await settleX402Call({
      chainId: params.ctx.chainId,
      serviceAddress: params.serviceAddress,
      tokenSymbol: params.ctx.tokenSymbol,
      threadId: params.ctx.threadId,
    });
    params.emit({
      type: 'step_settled',
      step: params.step,
      txHash,
      costAmount: X402_UNIT_COST_USD,
      tokenSymbol: params.ctx.tokenSymbol,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'x402 settle failed';
    params.emit({ type: 'step_failed', step: params.step, error: `x402 settle: ${msg}` });
    throw new Error(`x402 settle failed: ${msg}`);
  }
}
