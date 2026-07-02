'use client';

import { useEffect, useState } from 'react';
import { AgentTrace } from '@/components/AgentTrace';
import { initialState, applyEvent } from '@/lib/threadGeneration';
import type { ThreadGenerationState } from '@/lib/threadGeneration';
import type { PipelineEvent } from '@/lib/pipeline/types';

// Canned Mode-B run replayed through the REAL reducer — the landing demo is
// the actual generating screen, not a mock. Loops forever; costs nothing.
const SCRIPT: { at: number; e: PipelineEvent }[] = [
  { at: 400,  e: { type: 'started' } },
  { at: 900,  e: { type: 'step_started', step: 'serper' } },
  { at: 2200, e: { type: 'step_settled', step: 'serper', txHash: '0x7b71d5f7aa11de0c90b1a2c3d4e5f60718293a4b5c6d7e8f9012345678904821', costAmount: '0.010', tokenSymbol: 'cUSD' } },
  { at: 2600, e: { type: 'step_started', step: 'coingecko' } },
  { at: 3800, e: { type: 'step_settled', step: 'coingecko', txHash: '0x91ac0000000000000000000000000000000000000000000000000000000091ac', costAmount: '0.005', tokenSymbol: 'cUSD' } },
  { at: 4200, e: { type: 'step_started', step: 'groq' } },
  { at: 7200, e: { type: 'step_settled', step: 'groq', txHash: '0x33bd0000000000000000000000000000000000000000000000000000000033bd', costAmount: '0.001', tokenSymbol: 'cUSD' } },
  { at: 7600, e: { type: 'step_started', step: 'factCheck' } },
  { at: 9200, e: { type: 'step_settled', step: 'factCheck', txHash: '0x55ef0000000000000000000000000000000000000000000000000000000055ef', costAmount: '0.001', tokenSymbol: 'cUSD' } },
  { at: 9700, e: { type: 'done', totalCostUsd: '0.017' } },
];
const LOOP_MS = 12_000;

export function AgentTraceReplay() {
  const [state, setState] = useState<ThreadGenerationState>(initialState);
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const timers = SCRIPT.map(({ at, e }) =>
      setTimeout(() => setState((s) => applyEvent(s, e)), at),
    );
    const loop = setTimeout(() => {
      setState(initialState);
      setCycle((c) => c + 1);
    }, LOOP_MS);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(loop);
    };
  }, [cycle]);

  return (
    <div key={cycle} aria-hidden className="pointer-events-none select-none">
      <AgentTrace
        gen={state}
        payTxHash={'0xdemo000000000000000000000000000000000000000000000000000000000000'}
        threadId={4821n}
        chainExplorerBase="https://celoscan.io"
        agentWalletAddress="0x0000000000000000000000000000000000000000"
      />
    </div>
  );
}
