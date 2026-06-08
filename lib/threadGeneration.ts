// Pure state + reducer for the generation stream. Extracted from the hook so
// the transitions can be unit-tested without React or timers. The hook owns the
// side effects (fetch, SSE parsing, the stall watchdog); this owns the state.
//
// `isSlow` is ADVISORY: the stall watchdog sets it (in the hook) to show a
// "taking longer than usual" banner, but it is NEVER an outcome. The server's
// own deadline always resolves a run to `done` or `fatal`, so the client must
// not declare success/failure on its own — that mismatch is what caused the
// stuck-UI + refund-on-delivered-thread bug. Hence `applyEvent` only ever
// CLEARS `isSlow` (on forward progress / done / fatal); it never sets it.

import type { PipelineEvent, StepId } from '@/lib/pipeline/types';

export interface StepState {
  status: 'pending' | 'running' | 'settled' | 'failed';
  txHash?: string;
  costAmount?: string;
  tokenSymbol?: string;
  error?: string;
}

export interface ThreadGenerationState {
  steps: Record<StepId, StepState>;
  tweets: string[] | null;
  fatal: string | null;
  hasStarted: boolean;
  isDone: boolean;
  isSlow: boolean;
  totalCostUsd: string | null;
}

export const initialState: ThreadGenerationState = {
  steps: {
    serper: { status: 'pending' },
    coingecko: { status: 'pending' },
    groq: { status: 'pending' },
    factCheck: { status: 'pending' },
  },
  tweets: null,
  fatal: null,
  hasStarted: false,
  isDone: false,
  isSlow: false,
  totalCostUsd: null,
};

export function applyEvent(prev: ThreadGenerationState, e: PipelineEvent): ThreadGenerationState {
  switch (e.type) {
    case 'started':
      return { ...prev, hasStarted: true, isSlow: false };
    case 'step_started': {
      const steps = { ...prev.steps };
      steps[e.step] = { ...steps[e.step], status: 'running' };
      return { ...prev, steps, isSlow: false };
    }
    case 'step_settled': {
      const steps = { ...prev.steps };
      steps[e.step] = {
        ...steps[e.step],
        status: 'settled',
        txHash: e.txHash,
        costAmount: e.costAmount,
        tokenSymbol: e.tokenSymbol,
      };
      return { ...prev, steps, isSlow: false };
    }
    case 'step_failed': {
      // A failed step is activity, not forward progress — leave the advisory
      // banner as-is; the next step_started will clear it.
      const steps = { ...prev.steps };
      steps[e.step] = { ...steps[e.step], status: 'failed', error: e.error };
      return { ...prev, steps };
    }
    case 'step_output': {
      if (Array.isArray(e.output)) {
        return { ...prev, tweets: e.output as string[], isSlow: false };
      }
      if (e.output && typeof e.output === 'object') {
        const out = e.output as { final?: boolean; tweets?: string[] };
        if (out.final && Array.isArray(out.tweets)) {
          return { ...prev, tweets: out.tweets, isSlow: false };
        }
      }
      return prev;
    }
    case 'done':
      return { ...prev, isDone: true, totalCostUsd: e.totalCostUsd, isSlow: false };
    case 'fatal':
      return { ...prev, fatal: e.error, isDone: true, isSlow: false };
  }
}
