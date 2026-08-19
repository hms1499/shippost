'use client';

import { useEffect, useState } from 'react';
import { AgentTrace } from '@/components/AgentTrace';
import { initialState, applyEvent } from '@/lib/threadGeneration';
import type { ThreadGenerationState } from '@/lib/threadGeneration';
import type { PipelineEvent } from '@/lib/pipeline/types';
import { X402_UNIT_COST_USD } from '@/lib/tokens';

// Every x402 micro-charge settles for the same amount (lib/tokens.ts), so the
// demo reads it from there. Hardcoding once put 0.010 and 0.005 on the landing
// against a real 0.001 — the demo claimed the agent spends seventeen times what
// it does, contradicting the live counter a few pixels above it.
const UNIT = X402_UNIT_COST_USD;
const TOTAL = (Number(UNIT) * 4).toFixed(3);

const settled = (step: 'serper' | 'coingecko' | 'groq' | 'factCheck'): PipelineEvent => ({
  type: 'step_settled',
  step,
  txHash: '0x0',
  costAmount: UNIT,
  tokenSymbol: 'cUSD',
});

// Canned Mode-B run through the real reducer. Plays once and holds the
// finished frame — a loop next to the free-taste form is noise.
const SCRIPT: { at: number; e: PipelineEvent }[] = [
  { at: 400,  e: { type: 'started' } },
  { at: 900,  e: { type: 'step_started', step: 'serper' } },
  { at: 2200, e: settled('serper') },
  { at: 2600, e: { type: 'step_started', step: 'coingecko' } },
  { at: 3800, e: settled('coingecko') },
  { at: 4200, e: { type: 'step_started', step: 'groq' } },
  { at: 7200, e: settled('groq') },
  { at: 7600, e: { type: 'step_started', step: 'factCheck' } },
  { at: 9200, e: settled('factCheck') },
  { at: 9700, e: { type: 'done', totalCostUsd: TOTAL } },
];

export function AgentTraceReplay() {
  const [state, setState] = useState<ThreadGenerationState>(initialState);

  useEffect(() => {
    const timers = SCRIPT.map(({ at, e }) =>
      setTimeout(() => setState((s) => applyEvent(s, e)), at),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none select-none"
      ref={(el) => {
        if (el) el.inert = true;
      }}
    >
      <AgentTrace
        gen={state}
        payTxHash={null}
        threadId={null}
        chainExplorerBase="https://basescan.org"
        agentWalletAddress="0x0000000000000000000000000000000000000000"
        demo
      />
    </div>
  );
}
