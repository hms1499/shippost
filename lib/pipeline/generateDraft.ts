import Groq from 'groq-sdk';
import type { Hex } from 'viem';
import { parseThread, boundThread } from '@/lib/threadParser';
import { settleX402Call } from '@/lib/agent/orchestrator';
import { getSettleMode, X402_PRICE_USD, GROQ_MODEL } from '@/lib/x402/config';
import { payGroqViaX402 } from '@/lib/x402/client';
import { GROQ_COST_CUSD, GROQ_COST_HUMAN, GROQ_SINK } from './groqCost';
import type { PipelineContext } from './types';

export interface DraftInput {
  messages: { role: 'system' | 'user'; content: string }[];
  temperature: number;
  maxTokens: number;
}

export interface DraftResult {
  tweets: string[];
  txHash: Hex;
  costHuman: string;
  tokenSymbol: 'cUSD' | 'USDC';
}

// Produce a validated draft thread and settle for it. Settle gates delivery in
// both modes: legacy settles after boundThread here; x402 settles inside the
// proxy only after it returns a validated thread.
export async function generateDraft(ctx: PipelineContext, input: DraftInput): Promise<DraftResult> {
  if (getSettleMode(ctx.chainId) === 'x402') {
    const { tweets, settlementTxHash } = await payGroqViaX402({
      chainId: ctx.chainId,
      messages: input.messages,
      temperature: input.temperature,
      maxTokens: input.maxTokens,
    });
    return {
      tweets,
      txHash: (settlementTxHash || '0x0') as Hex,
      costHuman: X402_PRICE_USD,
      tokenSymbol: 'USDC',
    };
  }

  // legacy: call Groq directly, validate, then push-to-sink in cUSD.
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });
  const resp = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
  });
  const raw = resp.choices[0]?.message?.content ?? '';
  if (!raw.trim()) throw new Error('Groq returned empty content');

  const tweets = boundThread(parseThread(raw));
  const txHash = await settleX402Call({
    chainId: ctx.chainId,
    serviceAddress: GROQ_SINK,
    tokenSymbol: 'cUSD',
    amount: GROQ_COST_CUSD,
    threadId: ctx.threadId,
  });
  return { tweets, txHash, costHuman: GROQ_COST_HUMAN, tokenSymbol: 'cUSD' };
}
