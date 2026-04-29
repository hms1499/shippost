import { NextResponse } from 'next/server';

interface GroqRequest {
  threadId: string;
  topic: string;
  mode: 0 | 1;
}

export async function POST(req: Request) {
  const body = (await req.json()) as GroqRequest;

  // MOCK_SETTLE=true (default in Week 1) — no on-chain settlement.
  // Flip to false in Week 2 when AgentWallet.executeX402Call is ready.
  const mockSettle = process.env.MOCK_SETTLE !== 'false';
  if (mockSettle) {
    console.log(`[MOCK] x402 settle skipped for threadId=${body.threadId}`);
  }

  const mock = [
    `1/ (mock) Thread about: ${body.topic}`,
    `2/ This is a placeholder response from the x402 proxy.`,
    `3/ Thread id: ${body.threadId}`,
    `4/ Replaced with real Groq generation in Task 21.`,
  ].join('\n\n');

  return NextResponse.json({ output: mock, settled: !mockSettle });
}
