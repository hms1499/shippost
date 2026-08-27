import Groq from 'groq-sdk';
import { getAddress } from 'viem';
import { parseThread, boundThread } from '@/lib/threadParser';
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

  // boundThread, not a bare parseThread: this output REPLACES the draft
  // (runModeB.ts), so it needs the same empty/runaway validation the draft
  // itself gets in generateDraft.ts.
  const tweets = boundThread(parseThread(raw));

  // The fact-check has the last word on 5 of the 6 modes, and its result is
  // persisted as `completed` — which no refund path reverses. The prompt asks
  // for one tweet per draft tweet, same order, no commentary; when the model
  // ignores that, parseThread still returns something that LOOKS like a thread.
  // A refusal ("I cannot verify these claims.") collapses a 7-tweet draft to a
  // single line of apology; a rambling answer inflates it to dozens. Neither is
  // a fact-check of this draft, so treat it as a soft-step failure: runModeB
  // catches, emits step_failed, and delivers the unchecked draft instead.
  //
  // Deliberately strict. Falling back costs the user a fact-check they can see
  // they didn't get; accepting a mismatch costs them the thread they paid for.
  if (tweets.length !== input.tweets.length) {
    throw new Error(
      `fact-check returned ${tweets.length} tweets for a ${input.tweets.length}-tweet draft`,
    );
  }

  // Settle BEFORE handing the content over, the same ordering groqStep and
  // runModeB use. Emitting first meant the client rendered the fact-checked
  // thread and then, if the settle threw, flickered back to the draft runModeB
  // falls back to — showing content this run had not paid for and then taking
  // it away. Now a failed settle simply never delivers the revision.
  await settleSoftStep({ ctx, step: 'factCheck', serviceAddress: FC_SINK, emit });

  emit({ type: 'step_output', step: 'factCheck', output: tweets });

  return { tweets };
}
