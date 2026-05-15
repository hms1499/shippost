import { parseEther } from 'viem';
import { settleX402Call } from '@/lib/agent/orchestrator';
import { retryOnce } from './retry';
import type { PipelineContext, PipelineEvent } from './types';

const SERPER_SINK = '0x00000000000000000000000000000000000053E2' as const;
const SERPER_COST_CUSD = parseEther('0.001');
const SERPER_ENDPOINT = 'https://google.serper.dev/search';

export interface SerperOrganicResult {
  title: string;
  snippet: string;
  link: string;
  date?: string;
}

export interface SerperResult {
  query: string;
  organic: SerperOrganicResult[];
  newsSnippet: string | null;
}

export async function runSerperStep(
  ctx: PipelineContext & { query: string },
  emit: (e: PipelineEvent) => void,
): Promise<SerperResult> {
  emit({ type: 'step_started', step: 'serper' });

  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('SERPER_API_KEY missing');

  let organic: SerperOrganicResult[] = [];
  let newsSnippet: string | null = null;

  try {
    // Retry only the fetch (no side effect) — settle stays outside, below.
    const data = await retryOnce(async () => {
      const res = await fetch(SERPER_ENDPOINT, {
        method: 'POST',
        headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: ctx.query, num: 5, gl: 'us', hl: 'en' }),
      });
      if (!res.ok) throw new Error(`Serper ${res.status}`);
      const json = (await res.json()) as {
        organic?: SerperOrganicResult[];
        answerBox?: { snippet?: string };
        knowledgeGraph?: { description?: string };
      };
      return {
        organic: json.organic ?? [],
        newsSnippet:
          json.answerBox?.snippet ?? json.knowledgeGraph?.description ?? null,
      };
    });
    organic = data.organic;
    newsSnippet = data.newsSnippet;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'serper failed';
    emit({ type: 'step_failed', step: 'serper', error: msg });
    throw e;
  }

  emit({ type: 'step_output', step: 'serper', output: { organic, newsSnippet } });

  try {
    const txHash = await settleX402Call({
      chainId: ctx.chainId,
      serviceAddress: SERPER_SINK,
      tokenSymbol: 'cUSD',
      amount: SERPER_COST_CUSD,
      threadId: ctx.threadId,
    });
    emit({
      type: 'step_settled',
      step: 'serper',
      txHash,
      costAmount: '0.001',
      tokenSymbol: 'cUSD',
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'x402 settle failed';
    emit({ type: 'step_failed', step: 'serper', error: `x402 settle: ${msg}` });
    throw new Error(`x402 settle failed: ${msg}`);
  }

  return { query: ctx.query, organic, newsSnippet };
}
