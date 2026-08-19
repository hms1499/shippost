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
  chainId?: number;
  error?: string;
}

/**
 * Where a fatal came from. The three mean very different things to someone who
 * has already paid, and collapsing them into one string is what let a rejected
 * request ("HTTP 402") be presented as a failed pipeline run, complete with a
 * refund button that answers `thread not found`:
 *
 * - `pipeline` — the run started and the server gave up on it. A thread row
 *   exists, so it is refundable through the normal queue.
 * - `rejected` — the server refused to start it (402 unverified payment, 409
 *   replay, 503 could-not-record). NO thread row exists for 402/503, so there
 *   is nothing to refund against and the user needs their pay tx instead.
 * - `network` — the connection dropped. Says nothing about the run, which keeps
 *   going server-side (the `emit` guard in /api/generate/stream) and may well
 *   deliver.
 */
export type FatalKind = 'pipeline' | 'rejected' | 'network';

export interface ThreadGenerationState {
  steps: Record<StepId, StepState>;
  tweets: string[] | null;
  fatal: string | null;
  fatalKind: FatalKind | null;
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
  fatalKind: null,
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
        chainId: e.chainId,
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
      // Only the SSE event reaches this reducer, and it only exists once the
      // stream is open — so a fatal here is always a run the server started.
      return { ...prev, fatal: e.error, fatalKind: 'pipeline', isDone: true, isSlow: false };
  }
}
