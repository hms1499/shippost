import { runModeA, MODE_A_TOTAL_COST_USD } from '@/lib/pipeline/runModeA';
import { getContracts } from '@/lib/contracts';
import { getSupabaseServer } from '@/lib/supabase';
import type { PipelineEvent } from '@/lib/pipeline/types';

interface StreamRequest {
  threadId: string;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  chainId: number;
  walletAddress: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  tokenAddress: string;
  amountPaidRaw: string;
  payTxHash: string;
}

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

export async function POST(req: Request) {
  let body: StreamRequest;
  try {
    body = (await req.json()) as StreamRequest;
  } catch {
    return new Response('invalid json body', { status: 400 });
  }

  if (!body.topic?.trim()) return new Response('topic required', { status: 400 });
  if (!body.threadId) return new Response('threadId required', { status: 400 });
  if (!body.chainId) return new Response('chainId required', { status: 400 });
  if (!body.walletAddress) return new Response('walletAddress required', { status: 400 });
  if (!body.tokenSymbol) return new Response('tokenSymbol required', { status: 400 });
  if (!body.tokenAddress) return new Response('tokenAddress required', { status: 400 });
  if (!body.amountPaidRaw) return new Response('amountPaidRaw required', { status: 400 });
  if (!body.payTxHash) return new Response('payTxHash required', { status: 400 });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const supabase = getSupabaseSafe();
      let groqTx: string | null = null;

      const emit = (e: PipelineEvent) => {
        if (e.type === 'step_settled' && e.step === 'groq') groqTx = e.txHash;
        controller.enqueue(encoder.encode(sseLine(e)));
      };

      // Insert pending row up-front so we record paid attempts even if pipeline fails.
      if (supabase) {
        const { error } = await supabase.from('threads').insert({
          chain_id: body.chainId,
          onchain_thread_id: body.threadId,
          wallet_address: body.walletAddress.toLowerCase(),
          mode: 0,
          token_symbol: body.tokenSymbol,
          token_address: body.tokenAddress.toLowerCase(),
          amount_paid_raw: body.amountPaidRaw,
          pay_tx_hash: body.payTxHash.toLowerCase(),
          topic: body.topic,
          audience: body.audience,
          length: body.length,
          status: 'pending',
        });
        if (error) console.error('[supabase] insert pending failed:', error.message);
      }

      // Flush an initial byte so Vercel's 25s first-byte timeout doesn't
      // kill the connection while Groq is still thinking.
      emit({ type: 'started' });

      try {
        const contracts = getContracts(body.chainId);
        const output = await runModeA(
          {
            chainId: body.chainId,
            threadId: BigInt(body.threadId),
            topic: body.topic,
            audience: body.audience,
            length: body.length,
            agentWallet: contracts.AgentWallet,
          },
          emit,
        );

        if (supabase) {
          const { error } = await supabase
            .from('threads')
            .update({
              tweets: output.tweets,
              total_cost_usd: MODE_A_TOTAL_COST_USD,
              groq_tx_hash: groqTx,
              status: 'completed',
            })
            .eq('chain_id', body.chainId)
            .eq('onchain_thread_id', body.threadId);
          if (error) console.error('[supabase] update completed failed:', error.message);
        }

        emit({
          type: 'step_output',
          step: 'groq',
          output: { final: true, tweets: output.tweets },
        });
        emit({ type: 'done', totalCostUsd: MODE_A_TOTAL_COST_USD });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'pipeline failed';

        if (supabase) {
          const { error } = await supabase
            .from('threads')
            .update({
              status: 'failed',
              error_message: msg,
              groq_tx_hash: groqTx,
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
