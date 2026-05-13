import Groq from 'groq-sdk';
import { parseEther } from 'viem';
import { settleX402Call } from '@/lib/agent/orchestrator';
import { parseThread } from '@/lib/threadParser';
import { FACT_CHECK_SYSTEM, buildFactCheckUserPrompt } from '@/lib/prompts/factCheck';
import type { PipelineContext, PipelineEvent } from './types';

const FC_SINK = '0x00000000000000000000000000000000000FAC7C' as const;
const FC_COST_CUSD = parseEther('0.001');

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
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: FACT_CHECK_SYSTEM },
        { role: 'user', content: buildFactCheckUserPrompt(input) },
      ],
      temperature: 0.1,
      max_tokens: 1400,
    });
    raw = resp.choices[0]?.message?.content ?? '';
    if (!raw.trim()) throw new Error('fact-check returned empty');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'fact-check failed';
    emit({ type: 'step_failed', step: 'factCheck', error: msg });
    throw e;
  }

  const tweets = parseThread(raw);
  emit({ type: 'step_output', step: 'factCheck', output: tweets });

  try {
    const txHash = await settleX402Call({
      chainId: ctx.chainId,
      serviceAddress: FC_SINK,
      tokenSymbol: 'cUSD',
      amount: FC_COST_CUSD,
      threadId: ctx.threadId,
    });
    emit({
      type: 'step_settled',
      step: 'factCheck',
      txHash,
      costAmount: '0.001',
      tokenSymbol: 'cUSD',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'x402 settle failed';
    emit({ type: 'step_failed', step: 'factCheck', error: `x402 settle: ${msg}` });
    throw new Error(`x402 settle failed: ${msg}`);
  }

  return { tweets };
}
