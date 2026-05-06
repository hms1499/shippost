import { runModeA, MODE_A_TOTAL_COST_USD } from '@/lib/pipeline/runModeA';
import { runModeB } from '@/lib/pipeline/runModeB';
import { getContracts } from '@/lib/contracts';
import { getSupabaseServer } from '@/lib/supabase';
import type { PipelineEvent } from '@/lib/pipeline/types';
import type { Angle } from '@/lib/prompts/modeB';

interface StreamRequest {
  threadId: string;
  chainId: number;
  walletAddress: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  tokenAddress: string;
  amountPaidRaw: string;
  payTxHash: string;
  mode: 0 | 1;
  // Mode A
  topic?: string;
  audience?: 'beginner' | 'intermediate' | 'advanced';
  // Mode B
  eventDescription?: string;
  angle?: Angle;
}

const VALID_AUDIENCES = ['beginner', 'intermediate', 'advanced'] as const;
const VALID_ANGLES: Angle[] = ['bullish', 'bearish', 'skeptical'];

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sseLine(e: PipelineEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

function getSupabaseSafe() {
  try {
    return getSupabaseServer();
  } catch {
    return null;
  }
}

function validate(b: Partial<StreamRequest>): string | null {
  if (!b.threadId) return 'threadId required';
  if (!b.chainId) return 'chainId required';
  if (!b.walletAddress) return 'walletAddress required';
  if (!b.tokenSymbol) return 'tokenSymbol required';
  if (!b.tokenAddress) return 'tokenAddress required';
  if (!b.amountPaidRaw) return 'amountPaidRaw required';
  if (!b.payTxHash) return 'payTxHash required';
  if (b.mode !== 0 && b.mode !== 1) return 'mode must be 0 or 1';

  if (b.mode === 0) {
    if (!b.topic?.trim()) return 'topic required for Mode A';
    if (b.audience && !VALID_AUDIENCES.includes(b.audience)) return 'invalid audience';
  } else {
    if (!b.eventDescription?.trim()) return 'eventDescription required for Mode B';
    if (b.angle && !VALID_ANGLES.includes(b.angle)) return 'invalid angle';
  }
  return null;
}

export async function POST(req: Request) {
  let body: StreamRequest;
  try {
    body = (await req.json()) as StreamRequest;
  } catch {
    return new Response('invalid json body', { status: 400 });
  }

  const err = validate(body);
  if (err) return new Response(err, { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const supabase = getSupabaseSafe();

      const txByStep: Partial<Record<'groq' | 'serper' | 'factCheck', string>> = {};
      let capturedTweets: string[] | null = null;

      const emit = (e: PipelineEvent) => {
        if (e.type === 'step_settled' && e.step !== 'coingecko' && e.txHash !== '0x0') {
          if (e.step === 'groq' || e.step === 'serper' || e.step === 'factCheck') {
            txByStep[e.step] = e.txHash;
          }
        }
        if (
          e.type === 'step_output' &&
          e.step === 'groq' &&
          Array.isArray(e.output)
        ) {
          capturedTweets = e.output as string[];
        }
        controller.enqueue(encoder.encode(sseLine(e)));
      };

      // Insert pending row up-front so we record paid attempts even if pipeline fails.
      if (supabase) {
        const { error } = await supabase.from('threads').insert({
          chain_id: body.chainId,
          onchain_thread_id: body.threadId,
          wallet_address: body.walletAddress.toLowerCase(),
          mode: body.mode,
          token_symbol: body.tokenSymbol,
          token_address: body.tokenAddress.toLowerCase(),
          amount_paid_raw: body.amountPaidRaw,
          pay_tx_hash: body.payTxHash.toLowerCase(),
          topic: body.topic ?? body.eventDescription ?? null,
          audience: body.audience ?? null,
          angle: body.angle ?? null,
          status: 'pending',
        });
        if (error) console.error('[supabase] insert pending failed:', error.message);
      }

      // Flush an initial byte so Vercel's 25s first-byte timeout doesn't
      // kill the connection while the first AI call is still running.
      emit({ type: 'started' });

      try {
        const contracts = getContracts(body.chainId);
        const baseCtx = {
          chainId: body.chainId,
          threadId: BigInt(body.threadId),
          topic: body.topic ?? body.eventDescription ?? '',
          audience: body.audience ?? 'beginner',
          agentWallet: contracts.AgentWallet,
        } as const;

        let tweets: string[];
        let totalCostUsd: string;
        let searchSummary: string | null = null;
        let marketSnippet: string | null = null;

        if (body.mode === 0) {
          const out = await runModeA(baseCtx, emit);
          tweets = out.tweets;
          totalCostUsd = MODE_A_TOTAL_COST_USD;
        } else {
          const out = await runModeB(
            {
              ...baseCtx,
              angle: body.angle ?? 'skeptical',
              eventDescription: body.eventDescription ?? '',
            },
            emit,
          );
          tweets = out.tweets;
          totalCostUsd = out.totalCostUsd;
          searchSummary = out.searchSummary;
          marketSnippet = out.marketSnippet;
        }

        if (supabase) {
          const { error } = await supabase
            .from('threads')
            .update({
              tweets,
              total_cost_usd: totalCostUsd,
              groq_tx_hash: txByStep.groq ?? null,
              serper_tx_hash: txByStep.serper ?? null,
              fact_check_tx_hash: txByStep.factCheck ?? null,
              search_summary: searchSummary,
              market_snippet: marketSnippet,
              status: 'completed',
            })
            .eq('chain_id', body.chainId)
            .eq('onchain_thread_id', body.threadId);
          if (error) console.error('[supabase] update completed failed:', error.message);
        }

        emit({
          type: 'step_output',
          step: 'groq',
          output: { final: true, tweets },
        });
        emit({ type: 'done', totalCostUsd });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'pipeline failed';

        if (supabase) {
          // Persist partial state on failure so admin can recover/refund the user.
          const { error } = await supabase
            .from('threads')
            .update({
              tweets: capturedTweets,
              status: 'failed',
              error_message: msg,
              groq_tx_hash: txByStep.groq ?? null,
              serper_tx_hash: txByStep.serper ?? null,
              fact_check_tx_hash: txByStep.factCheck ?? null,
            })
            .eq('chain_id', body.chainId)
            .eq('onchain_thread_id', body.threadId);
          if (error) console.error('[supabase] update failed failed:', error.message);
        }

        emit({ type: 'fatal', error: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
