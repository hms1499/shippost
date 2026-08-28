'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
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

const FINISHED = SCRIPT.reduce((s, { e }) => applyEvent(s, e), initialState);

export function AgentTraceReplay() {
  const [state, setState] = useState<ThreadGenerationState>(initialState);
  const hostRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (hostRef.current) hostRef.current.inert = true;
  }, []);

  useEffect(() => {
    // Reduced motion: no timed playback at all. Hold the finished frame, which
    // still carries the evidence — four settled steps and a total.
    if (reduce) {
      setState(FINISHED);
      return;
    }

    const start = () =>
      SCRIPT.map(({ at, e }) => setTimeout(() => setState((s) => applyEvent(s, e)), at));

    // The script plays once and holds the last frame. Started on mount, a phone
    // user — who meets this panel only after scrolling past the hero — arrived
    // to a finished, motionless panel, on the one screen whose entire job is to
    // be caught in the act. Start it on first intersection instead.
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === 'undefined') {
      const timers = start();
      return () => timers.forEach(clearTimeout);
    }

    let timers: ReturnType<typeof setTimeout>[] = [];
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((en) => en.isIntersecting)) return;
        io.disconnect();
        timers = start();
      },
      { threshold: 0.35 },
    );
    io.observe(host);
    return () => {
      io.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [reduce]);

  return (
    <div ref={hostRef} aria-hidden className="pointer-events-none select-none">
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
