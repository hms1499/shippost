import Groq from 'groq-sdk';
import { getAddress } from 'viem';
import { parseThread } from '@/lib/threadParser';
import { retryOnce } from './retry';
import { settleSoftStep } from './settleSoftStep';
import { FACT_CHECK_SYSTEM, buildFactCheckUserPrompt } from '@/lib/prompts/factCheck';
import { GROQ_MODEL, groqCompletionExtras } from '@/lib/x402/config';
import type { PipelineContext, PipelineEvent } from './types';

// Simulated micro-payment sink. Run through getAddress so an invalid vanity
// literal fails loudly at module load instead of silently throwing inside the
// x402 settle (viem rejects a non-checksummed mixed-case address).
const FC_SINK = getAddress('0x00000000000000000000000000000000000fac7c');

interface FactCheckInput {
  tweets: string[];
  searchSummary: string | null;
  marketData: string | null;
}

export async function runFactCheckStep(
  ctx: PipelineContext,
  input: FactCheckInput,
  emit: (e: PipelineEvent) => void,
): Promise<{ tweets: string[] }> {
  emit({ type: 'step_started', step: 'factCheck' });

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY missing');
  const groq = new Groq({ apiKey });

  let raw: string;
  try {
    // Retry only the LLM call (no side effect) — settle stays outside, below.
    raw = await retryOnce(async () => {
      const resp = await groq.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: 'system', content: FACT_CHECK_SYSTEM },
          { role: 'user', content: buildFactCheckUserPrompt(input) },
        ],
        temperature: 0.1,
        max_tokens: 1400,
        ...groqCompletionExtras(),
      });
      const out = resp.choices[0]?.message?.content ?? '';
      if (!out.trim()) throw new Error('fact-check returned empty');
      return out;
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'fact-check failed';
    emit({ type: 'step_failed', step: 'factCheck', error: msg });
    throw e;
  }

  const tweets = parseThread(raw);
  emit({ type: 'step_output', step: 'factCheck', output: tweets });

  await settleSoftStep({ ctx, step: 'factCheck', serviceAddress: FC_SINK, emit });

  return { tweets };
}
