import Groq from 'groq-sdk';
import type { Hex } from 'viem';
import { parseThread, boundThread } from '@/lib/threadParser';
import { fitThread } from '@/lib/threadShape';
import { settleX402Call } from '@/lib/agent/orchestrator';
import { getSettleMode, getSettleChainId, X402_PRICE_USD, GROQ_MODEL, groqCompletionExtras } from '@/lib/x402/config';
import { payGroqViaX402 } from '@/lib/x402/client';
import { alertOps } from '@/lib/alert';
import { GROQ_COST_HUMAN, GROQ_SINK } from './groqCost';
import { throwIfAborted } from './abort';
import type { TokenSymbol } from '@/lib/tokens';
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
  // Model 1 (legacy) settles in the user's payment token; Model 2 (x402) always
  // settles USDC on Base. TokenSymbol already covers cUSD | USDT | USDC.
  tokenSymbol: TokenSymbol;
  // Settle chain when it differs from the payment chain — x402 path only.
  chainId?: number;
}

// The thread AS THE MODEL PRODUCED IT: called, validated, parsed — not yet
// fitted to the character limit. Exported so a measurement harness can compare
// before and after from ONE completion; sampling twice would measure the
// model's variance instead of the fit. Nothing in the paid flow should call
// this directly — generateTweets is the delivering form.
export async function completeThread(input: DraftInput): Promise<string[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });
  const resp = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: input.messages,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    ...groqCompletionExtras(),
  });
  const raw = resp.choices[0]?.message?.content ?? '';
  if (!raw.trim()) throw new Error('Groq returned empty content');
  return boundThread(parseThread(raw));
}

// Direct Groq generation: call, validate, parse, fit — NO settle, NO abort
// plumbing. Reused by the paid `generateDraft` (legacy branch) and the preview.
//
// The prompt asks the model to keep every tweet under 280 (system.ts:28) and it
// does not always manage it. Split what can be split at a sentence seam before
// anyone sees the thread; a tweet with no seam still comes through and the
// editor keeps warning about it. Applies to the free preview too — an over-long
// hook is where an unpostable tweet costs the most.
export async function generateTweets(input: DraftInput): Promise<string[]> {
  return fitThread(await completeThread(input)).tweets;
}

// Produce a validated draft thread and settle for it. Settle gates delivery in
// both modes: legacy settles after boundThread here; x402 settles inside the
// proxy only after it returns a validated thread.
export async function generateDraft(ctx: PipelineContext, input: DraftInput): Promise<DraftResult> {
  throwIfAborted(ctx.signal);

  if (getSettleMode() === 'x402') {
    const settleChainId = getSettleChainId();
    try {
      const { tweets, settlementTxHash } = await payGroqViaX402({
        chainId: settleChainId,
        messages: input.messages,
        temperature: input.temperature,
        maxTokens: input.maxTokens,
        // Forward the deadline so a timeout mid-proxy-call cancels before settle,
        // mirroring the legacy path's re-check right before settleX402Call.
        signal: ctx.signal,
      });
      return {
        // Fitted here, not inside the proxy route: /api/x402/groq is a service
        // other agents pay for, and changing the tweet count in a response
        // somebody bought is a change to that contract. We fit what we consume.
        tweets: fitThread(tweets).tweets,
        txHash: (settlementTxHash || '0x0') as Hex,
        costHuman: X402_PRICE_USD,
        tokenSymbol: 'USDC',
        chainId: settleChainId,
      };
    } catch (e) {
      // Deadline fired: the run is already fatal + refundable — never settle
      // anything after that, in either mode.
      if (ctx.signal?.aborted) throw e;
      // Infra failure (facilitator down, cap hit, paused, empty float, proxy
      // 5xx): degrade to the legacy settle below so a paid user still gets
      // their thread. Alert is fire-and-forget; alertOps never throws.
      void alertOps('x402 settle fell back to legacy', {
        threadId: ctx.threadId.toString(),
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // legacy: call Groq directly, validate, then push-to-sink in cUSD.
  // Also the x402 infra-failure fallback path.
  const tweets = await generateTweets(input);
  // Re-check: the deadline may have fired while Groq was responding. Never
  // settle (spend) after the run is already considered failed.
  throwIfAborted(ctx.signal);
  const txHash = await settleX402Call({
    chainId: ctx.chainId,
    serviceAddress: GROQ_SINK,
    tokenSymbol: ctx.tokenSymbol,
    threadId: ctx.threadId,
  });
  return { tweets, txHash, costHuman: GROQ_COST_HUMAN, tokenSymbol: ctx.tokenSymbol };
}
