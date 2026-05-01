import Groq from 'groq-sdk';
import { parseEther } from 'viem';
import { settleX402Call } from '@/lib/orchestrator';
import { parseThread } from '@/lib/threadParser';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeAPrompt } from '@/lib/prompts/modeA';
import type { PipelineContext, PipelineEvent } from './types';

const GROQ_SINK = '0x000000000000000000000000000000000000dead' as const;
const GROQ_COST_CUSD = parseEther('0.001');

export async function runGroqStep(
  ctx: PipelineContext,
  emit: (e: PipelineEvent) => void,
): Promise<{ tweets: string[] }> {
  emit({ type: 'step_started', step: 'groq' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });

  const userPrompt = buildModeAPrompt({
    topic: ctx.topic,
    audience: ctx.audience,
    length: ctx.length,
  });

  let raw: string;
  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1200,
    });
    raw = resp.choices[0]?.message?.content ?? '';
    if (!raw.trim()) throw new Error('Groq returned empty content');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Groq failed';
    emit({ type: 'step_failed', step: 'groq', error: msg });
    throw e;
  }

  const tweets = parseThread(raw);
  emit({ type: 'step_output', step: 'groq', output: tweets });

  try {
    const txHash = await settleX402Call({
      chainId: ctx.chainId,
      serviceAddress: GROQ_SINK,
      tokenSymbol: 'cUSD',
      amount: GROQ_COST_CUSD,
      threadId: ctx.threadId,
    });
    emit({
      type: 'step_settled',
      step: 'groq',
      txHash,
      costAmount: '0.001',
      tokenSymbol: 'cUSD',
    });
  } catch (e) {
    console.error('groq x402 settle failed', e);
  }

  return { tweets };
}
