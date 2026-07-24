import Groq from 'groq-sdk';
import { getAddress } from 'viem';
import { settleX402Call } from '@/lib/agent/orchestrator';
import { X402_UNIT_COST_USD } from '@/lib/tokens';
import { parseThread } from '@/lib/threadParser';
import { retryOnce } from './retry';
import { throwIfAborted } from './abort';
import { FACT_CHECK_SYSTEM, buildFactCheckUserPrompt } from '@/lib/prompts/factCheck';
import type { PipelineContext, PipelineEvent } from './types';

// Simulated micro-payment sink. Run through getAddress so an invalid vanity
// literal fails loudly at module load instead of silently throwing inside the
// x402 settle (viem rejects a non-checksummed mixed-case address).
const FC_SINK = getAddress('0x00000000000000000000000000000000000fac7c');

interface FactCheckInput {
  tweets: string[];
  searchSummary: string | null;
  marketData: string | null;
}

export async function runFactCheckStep(
  ctx: PipelineContext,
  input: FactCheckInput,
  emit: (e: PipelineEvent) => void,
): Promise<{ tweets: string[] }> {
  emit({ type: 'step_started', step: 'factCheck' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });

  let raw: string;
  try {
    // Retry only the LLM call (no side effect) — settle stays outside, below.
    raw = await retryOnce(async () => {
      const resp = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: FACT_CHECK_SYSTEM },
          { role: 'user', content: buildFactCheckUserPrompt(input) },
        ],
        temperature: 0.1,
        max_tokens: 1400,
      });
      const out = resp.choices[0]?.message?.content ?? '';
      if (!out.trim()) throw new Error('fact-check returned empty');
      return out;
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'fact-check failed';
    emit({ type: 'step_failed', step: 'factCheck', error: msg });
    throw e;
  }

  const tweets = parseThread(raw);
  emit({ type: 'step_output', step: 'factCheck', output: tweets });

  // Don't settle if the deadline fired while the model was responding.
  throwIfAborted(ctx.signal);

  try {
    const txHash = await settleX402Call({
      chainId: ctx.chainId,
      serviceAddress: FC_SINK,
      tokenSymbol: ctx.tokenSymbol,
      threadId: ctx.threadId,
    });
    emit({
      type: 'step_settled',
      step: 'factCheck',
      txHash,
      costAmount: X402_UNIT_COST_USD,
      tokenSymbol: ctx.tokenSymbol,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'x402 settle failed';
    emit({ type: 'step_failed', step: 'factCheck', error: `x402 settle: ${msg}` });
    throw new Error(`x402 settle failed: ${msg}`);
  }

  return { tweets };
}
