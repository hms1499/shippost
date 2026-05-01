import { runModeA, MODE_A_TOTAL_COST_USD } from '@/lib/pipeline/runModeA';
import { getContracts } from '@/lib/contracts';
import type { PipelineEvent } from '@/lib/pipeline/types';

interface StreamRequest {
  threadId: string;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  length: 5 | 8 | 12;
  chainId: number;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function sseLine(e: PipelineEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

export async function POST(req: Request) {
  let body: StreamRequest;
  try {
    body = (await req.json()) as StreamRequest;
  } catch {
    return new Response('invalid json body', { status: 400 });
  }

  if (!body.topic?.trim()) {
    return new Response('topic required', { status: 400 });
  }
  if (!body.threadId) {
    return new Response('threadId required', { status: 400 });
  }
  if (!body.chainId) {
    return new Response('chainId required', { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (e: PipelineEvent) => {
        controller.enqueue(encoder.encode(sseLine(e)));
      };

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
        emit({
          type: 'step_output',
          step: 'groq',
          output: { final: true, tweets: output.tweets },
        });
        emit({ type: 'done', totalCostUsd: MODE_A_TOTAL_COST_USD });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'pipeline failed';
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
