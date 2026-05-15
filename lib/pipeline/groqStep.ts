import Groq from 'groq-sdk';
import { parseEther, formatEther } from 'viem';
import { settleX402Call } from '@/lib/agent/orchestrator';
import { parseThread, boundThread } from '@/lib/threadParser';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeAPrompt } from '@/lib/prompts/modeA';
import type { PipelineContext, PipelineEvent } from './types';

// x402 settlement sink. We run a custom proxy (no Coinbase facilitator), so
// by default settlement BURNS the spend to the dead address to demonstrate
// the on-chain flow without a real payee. This is real money to nowhere —
// set X402_SINK_ADDRESS in prod to route it to a real treasury (no code
// change). Malformed env falls back to the burn address rather than reverting.
const RAW_SINK = process.env.X402_SINK_ADDRESS;
export const GROQ_SINK = (RAW_SINK && /^0x[a-fA-F0-9]{40}$/.test(RAW_SINK)
  ? RAW_SINK
  : '0x000000000000000000000000000000000000dead') as `0x${string}`;

// Single source of truth for the Groq x402 charge. The displayed cost is
// derived from the same bigint that's actually settled on-chain, so the
// number shown to the user can't drift from what moved.
export const GROQ_COST_CUSD = parseEther('0.001');
export const GROQ_COST_HUMAN = formatEther(GROQ_COST_CUSD);

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

  const tweets = boundThread(parseThread(raw));

  // Settle gates delivery: spend x402 BEFORE the tweets leave the server, so
  // a failed or uncapped settle can't yield free content the user then also
  // gets refunded for.
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
      costAmount: GROQ_COST_HUMAN,
      tokenSymbol: 'cUSD',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'x402 settle failed';
    emit({ type: 'step_failed', step: 'groq', error: `x402 settle: ${msg}` });
    throw new Error(`x402 settle failed: ${msg}`);
  }

  emit({ type: 'step_output', step: 'groq', output: tweets });
  return { tweets };
}
