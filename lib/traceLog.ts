// Pure derivation of terminal log lines from ThreadGenerationState snapshots.
// The SSE hook reduces events into state; this diffs consecutive snapshots so
// AgentTrace can append log lines without touching the event stream. Keyed by
// `${step}:${status}` so replays/re-renders never duplicate a line.

import type { StepId } from '@/lib/pipeline/types';
import type { ThreadGenerationState } from '@/lib/threadGeneration';

export type TraceLine = {
  key: string;
  glyph: 'ok' | 'run' | 'fail' | 'info';
  text: string;
  amount?: string;
  txHash?: string;
};

const STEP_LABEL: Record<StepId, string> = {
  serper: 'serper.ai · grounding',
  coingecko: 'coingecko · market data',
  groq: 'groq/llama-3.3-70b · drafting',
  factCheck: 'factcheck · verifying claims',
};

const ORDER: StepId[] = ['serper', 'coingecko', 'groq', 'factCheck'];

export function appendTraceLines(
  lines: TraceLine[],
  prev: ThreadGenerationState,
  next: ThreadGenerationState,
): TraceLine[] {
  const out = [...lines];
  const seen = new Set(out.map((l) => l.key));
  const push = (l: TraceLine) => {
    if (!seen.has(l.key)) {
      out.push(l);
      seen.add(l.key);
    }
  };

  for (const id of ORDER) {
    const p = prev.steps[id];
    const n = next.steps[id];
    if (p.status === n.status) continue;
    if (n.status === 'running') {
      push({ key: `${id}:running`, glyph: 'run', text: `${STEP_LABEL[id]}…` });
    } else if (n.status === 'settled') {
      push({
        key: `${id}:settled`,
        glyph: 'ok',
        text: `${STEP_LABEL[id]} — settled`,
        amount: n.costAmount ? `$${n.costAmount}` : undefined,
        txHash: n.txHash,
      });
    } else if (n.status === 'failed') {
      push({
        key: `${id}:failed`,
        glyph: 'fail',
        text: `${STEP_LABEL[id]} — ${n.error ?? 'failed'}`,
      });
    }
  }

  if (!prev.isDone && next.isDone && !next.fatal) {
    push({
      key: 'done',
      glyph: 'ok',
      text: next.totalCostUsd
        ? `run complete — agent spent $${next.totalCostUsd}`
        : 'run complete',
    });
  }
  if (!prev.fatal && next.fatal) {
    push({ key: 'fatal', glyph: 'fail', text: `pipeline fatal — ${next.fatal}` });
  }
  return out;
}
