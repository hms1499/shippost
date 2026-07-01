import { getAddress, parseEther } from 'viem';
import { settleX402Call } from '@/lib/agent/orchestrator';
import { retryOnce } from './retry';
import { throwIfAborted } from './abort';
import type { PipelineContext, PipelineEvent } from './types';

// Simulated micro-payment sink. Run through getAddress so an invalid vanity
// literal fails loudly at module load instead of silently throwing inside the
// x402 settle (viem rejects a non-checksummed mixed-case address).
const SERPER_SINK = getAddress('0x00000000000000000000000000000000000053e2');
const SERPER_COST_CUSD = parseEther('0.001');
const SERPER_SEARCH_ENDPOINT = 'https://google.serper.dev/search';
const SERPER_NEWS_ENDPOINT = 'https://google.serper.dev/news';

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

// Google's time-based-search windows. Bias results toward recent coverage and
// away from years-old evergreen SEO pages, which is the actual freshness gap
// for event/market threads.
export type SerperRecency = 'qdr:h' | 'qdr:d' | 'qdr:w' | 'qdr:m';

export interface SerperOptions {
  // Restrict to a recency window (tbs). Omit for evergreen queries (Educational).
  recency?: SerperRecency;
  // 'news' hits the dated /news endpoint (headlines with timestamps); default
  // 'search' keeps the organic + answerBox behaviour.
  mode?: 'search' | 'news';
}

interface SerperNewsItem {
  title?: string;
  snippet?: string;
  link?: string;
  date?: string;
}

// Pure Serper fetch — no emit, no settle. Used by the paid step (which then
// settles + emits) and by the free preview (which does neither).
export async function fetchSerper(
  query: string,
  opts: SerperOptions = {},
): Promise<SerperResult> {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('SERPER_API_KEY missing');
  const endpoint = opts.mode === 'news' ? SERPER_NEWS_ENDPOINT : SERPER_SEARCH_ENDPOINT;
  const data = await retryOnce(async () => {
    const body: Record<string, unknown> = { q: query, num: 5, gl: 'us', hl: 'en' };
    if (opts.recency) body.tbs = opts.recency;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Serper ${res.status}`);
    const json = (await res.json()) as {
      organic?: SerperOrganicResult[];
      news?: SerperNewsItem[];
      answerBox?: { snippet?: string };
      knowledgeGraph?: { description?: string };
    };
    // The /news endpoint returns dated headlines under `news`; normalise them
    // into the same organic shape so summarizeSerper surfaces the timestamps.
    if (opts.mode === 'news') {
      const organic: SerperOrganicResult[] = (json.news ?? []).map((n) => ({
        title: n.title ?? '',
        snippet: n.snippet ?? '',
        link: n.link ?? '',
        date: n.date,
      }));
      return { organic, newsSnippet: null };
    }
    return {
      organic: json.organic ?? [],
      newsSnippet: json.answerBox?.snippet ?? json.knowledgeGraph?.description ?? null,
    };
  });
  return { query, organic: data.organic, newsSnippet: data.newsSnippet };
}

export async function runSerperStep(
  ctx: PipelineContext & { query: string; serperOpts?: SerperOptions },
  emit: (e: PipelineEvent) => void,
): Promise<SerperResult> {
  emit({ type: 'step_started', step: 'serper' });

  let organic: SerperOrganicResult[] = [];
  let newsSnippet: string | null = null;

  try {
    const data = await fetchSerper(ctx.query, ctx.serperOpts);
    organic = data.organic;
    newsSnippet = data.newsSnippet;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'serper failed';
    emit({ type: 'step_failed', step: 'serper', error: msg });
    throw e;
  }

  emit({ type: 'step_output', step: 'serper', output: { organic, newsSnippet } });

  // Don't settle if the deadline fired while fetching — the run is already failed.
  throwIfAborted(ctx.signal);

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
