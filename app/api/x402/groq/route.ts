import { NextResponse } from 'next/server';
import Groq from 'groq-sdk';
import { settleX402Call } from '@/lib/orchestrator';

interface GroqRequest {
  threadId: string;
  topic: string;
  mode: 0 | 1;
  chainId: number;
  audience?: 'beginner' | 'intermediate' | 'advanced';
  length?: 5 | 8 | 12;
}

// Placeholder sink address for x402 settlement
const SERVICE_ADDRESS = '0x000000000000000000000000000000000000dead' as const;

export async function POST(req: Request) {
  const body = (await req.json()) as GroqRequest;
  const apiKey = process.env.GROQ_API_KEY;

  const mockSettle = process.env.MOCK_SETTLE !== 'false';

  // In MOCK_SETTLE mode, return placeholder output without calling Groq
  if (mockSettle || !apiKey) {
    if (!apiKey && !mockSettle) {
      return NextResponse.json({ error: 'GROQ_API_KEY missing' }, { status: 500 });
    }
    console.log(`[MOCK] x402 settle skipped for threadId=${body.threadId}`);
    const mock = [
      `1/ (mock) Thread about: ${body.topic}`,
      `2/ This is a placeholder response from the x402 proxy.`,
      `3/ Thread id: ${body.threadId}`,
      `4/ Replaced with real Groq generation when MOCK_SETTLE=false.`,
    ].join('\n\n');
    return NextResponse.json({ output: mock, settled: false });
  }

  const groq = new Groq({ apiKey });
  const audience = body.audience ?? 'beginner';
  const length = body.length ?? 5;

  const prompt =
    body.mode === 0
      ? `Write a punchy X (Twitter) thread explaining "${body.topic}" to a ${audience} audience. Produce exactly ${length} tweets. Format each tweet as "N/" followed by content, separated by blank lines. Keep tweets <280 chars.`
      : `Write a hot take thread about: ${body.topic}. ${length} tweets.`;

  let output: string;
  try {
    const resp = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are a crypto/dev content writer. Keep tweets concise and high-signal.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 800,
    });
    output = resp.choices[0]?.message?.content ?? '(empty response)';
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'Groq failed' }, { status: 502 });
  }

  // Settle x402 on-chain after successful LLM call
  try {
    await settleX402Call({
      chainId: body.chainId,
      serviceAddress: SERVICE_ADDRESS,
      tokenSymbol: 'cUSD',
      amount: 1_000_000_000_000_000n, // 0.001 cUSD (18 decimals)
      threadId: BigInt(body.threadId),
    });
  } catch (e: any) {
    // Log but don't fail — thread still delivered to user
    console.error('x402 settlement failed:', e);
  }

  return NextResponse.json({ output });
}
