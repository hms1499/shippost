'use client';

import { useEffect, useState } from 'react';
import { AgentTrace } from '@/components/AgentTrace';
import { initialState, applyEvent } from '@/lib/threadGeneration';
import type { ThreadGenerationState } from '@/lib/threadGeneration';
import type { PipelineEvent } from '@/lib/pipeline/types';

// Canned Mode-B run through the real reducer. Plays once and holds the
// finished frame — a loop next to the free-taste form is noise.
const SCRIPT: { at: number; e: PipelineEvent }[] = [
  { at: 400,  e: { type: 'started' } },
  { at: 900,  e: { type: 'step_started', step: 'serper' } },
  { at: 2200, e: { type: 'step_settled', step: 'serper', txHash: '0x0', costAmount: '0.010', tokenSymbol: 'cUSD' } },
  { at: 2600, e: { type: 'step_started', step: 'coingecko' } },
  { at: 3800, e: { type: 'step_settled', step: 'coingecko', txHash: '0x0', costAmount: '0.005', tokenSymbol: 'cUSD' } },
  { at: 4200, e: { type: 'step_started', step: 'groq' } },
  { at: 7200, e: { type: 'step_settled', step: 'groq', txHash: '0x0', costAmount: '0.001', tokenSymbol: 'cUSD' } },
  { at: 7600, e: { type: 'step_started', step: 'factCheck' } },
  { at: 9200, e: { type: 'step_settled', step: 'factCheck', txHash: '0x0', costAmount: '0.001', tokenSymbol: 'cUSD' } },
  { at: 9700, e: { type: 'done', totalCostUsd: '0.017' } },
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
