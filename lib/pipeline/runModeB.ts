import Groq from 'groq-sdk';
import { parseEther } from 'viem';
import { settleX402Call } from '@/lib/orchestrator';
import { parseThread } from '@/lib/threadParser';
import { SYSTEM_PROMPT } from '@/lib/prompts/system';
import { buildModeBPrompt, summarizeSerper, summarizeMarket, type Angle } from '@/lib/prompts/modeB';
import { runSerperStep } from './serperStep';
import { runCoinGeckoStep } from './coingeckoStep';
import { runFactCheckStep } from './factCheckStep';
import type { PipelineContext, PipelineEvent } from './types';

const GROQ_SINK = '0x000000000000000000000000000000000000dead' as const;
const GROQ_COST_CUSD = parseEther('0.001');

export interface ModeBOutput {
  tweets: string[];
  searchSummary: string | null;
  marketSnippet: string | null;
  totalCostUsd: string;
}

interface ModeBContext extends PipelineContext {
  angle: Angle;
  eventDescription: string;
}

export async function runModeB(
  ctx: ModeBContext,
  emit: (e: PipelineEvent) => void,
): Promise<ModeBOutput> {
  let totalCost = 0;

  const wrappedEmit = (e: PipelineEvent) => {
    if (e.type === 'step_settled' && e.step !== 'coingecko') {
      const c = parseFloat(e.costAmount);
      if (!Number.isNaN(c)) totalCost += c;
    }
    emit(e);
  };

  // Step 1 — Serper search (soft-fail: continue with null context if API or settle fails)
  let searchSummary: string | null = null;
  try {
    const s = await runSerperStep({ ...ctx, query: ctx.eventDescription }, wrappedEmit);
    searchSummary = summarizeSerper(s.organic, s.newsSnippet);
  } catch (e) {
    console.error('[runModeB] serper failed, continuing with no search context:', e);
  }

  // Step 2 — CoinGecko market data (soft-fail: free API, no x402 settle)
  let marketSnippet: string | null = null;
  try {
    const cg = await runCoinGeckoStep(ctx, wrappedEmit);
    marketSnippet = summarizeMarket(cg);
  } catch (e) {
    console.error('[runModeB] coingecko failed:', e);
  }

  // Step 3 — Groq draft (HARD-fail: strict-settle, no thread = no value)
  emit({ type: 'step_started', step: 'groq' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });

  const userPrompt = buildModeBPrompt({
    eventDescription: ctx.eventDescription,
    angle: ctx.angle,
    searchSummary,
    marketSnippet,
  });

  let raw: string;
  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.85,
      max_tokens: 1400,
    });
    raw = resp.choices[0]?.message?.content ?? '';
    if (!raw.trim()) throw new Error('Groq returned empty draft');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'draft failed';
    emit({ type: 'step_failed', step: 'groq', error: msg });
    throw e;
  }

  const draftTweets = parseThread(raw);
  emit({ type: 'step_output', step: 'groq', output: draftTweets });

  try {
    const txHash = await settleX402Call({
      chainId: ctx.chainId,
      serviceAddress: GROQ_SINK,
      tokenSymbol: 'cUSD',
      amount: GROQ_COST_CUSD,
      threadId: ctx.threadId,
    });
    wrappedEmit({
      type: 'step_settled',
      step: 'groq',
      txHash,
      costAmount: '0.001',
      tokenSymbol: 'cUSD',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'x402 settle failed';
    emit({ type: 'step_failed', step: 'groq', error: `x402 settle: ${msg}` });
    throw new Error(`x402 settle failed: ${msg}`);
  }

  // Step 4 — Fact-check (soft-fail: fall back to draft if fact-check errors)
  let finalTweets = draftTweets;
  try {
    const fc = await runFactCheckStep(
      ctx,
      { tweets: draftTweets, searchSummary, marketData: marketSnippet },
      wrappedEmit,
    );
    finalTweets = fc.tweets;
  } catch (e) {
    console.error('[runModeB] fact-check failed, using draft:', e);
  }

  return {
    tweets: finalTweets,
    searchSummary,
    marketSnippet,
    totalCostUsd: totalCost.toFixed(3),
  };
}
