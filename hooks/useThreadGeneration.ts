'use client';

import { useCallback, useRef, useState } from 'react';
import type { PipelineEvent } from '@/lib/pipeline/types';
import { haptic } from '@/lib/haptics';
import { initialState, applyEvent } from '@/lib/threadGeneration';
import type { ThreadGenerationState } from '@/lib/threadGeneration';
import type { EventContext } from '@/lib/eventContext';

export type { StepState, ThreadGenerationState } from '@/lib/threadGeneration';

// Fires only after this long with NO forward progress (no step start/settle/
// output). Distinguishes a genuinely stalled pipeline from one that is just
// long-running (Mode B has 4 sequential x402 steps): the timer re-arms on
// every progress event, so a healthy-but-slow run never trips it.
//
// When it fires it sets `isSlow` (advisory banner only) — NOT `fatal`/`isDone`.
// The server's own deadline always resolves the run to `done` or `fatal`, so
// the client never declares an outcome the server might disagree with.
const STALL_WATCHDOG_MS = 60_000;

export function useThreadGeneration() {
  const [state, setState] = useState<ThreadGenerationState>(initialState);
  const abortRef = useRef<AbortController | null>(null);
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSlowTimer = useCallback(() => {
    if (slowTimerRef.current) {
      clearTimeout(slowTimerRef.current);
      slowTimerRef.current = null;
    }
  }, []);

  // (Re)start the stall watchdog. Called on generation start and on every
  // forward-progress event, so the deadline is measured from the LAST sign of
  // life, not from the start of the run.
  const armSlowTimer = useCallback(() => {
    clearSlowTimer();
    slowTimerRef.current = setTimeout(() => {
      setState((s) => (s.isDone || s.fatal ? s : { ...s, isSlow: true }));
    }, STALL_WATCHDOG_MS);
  }, [clearSlowTimer]);

  const apply = useCallback((e: PipelineEvent) => {
    setState((prev) => applyEvent(prev, e));
    if (e.type === 'done' || e.type === 'fatal') {
      clearSlowTimer();
      haptic(e.type === 'done' ? 'success' : 'error');
    } else if (
      e.type === 'started' ||
      e.type === 'step_started' ||
      e.type === 'step_settled' ||
      e.type === 'step_output'
    ) {
      armSlowTimer();
    }
  }, [clearSlowTimer, armSlowTimer]);

  const start = useCallback(
    async (params: StartParams) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setState(initialState);
      armSlowTimer();

      let res: Response;
      try {
        res = await fetch('/api/generate/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: params.threadId.toString(),
            chainId: params.chainId,
            walletAddress: params.walletAddress,
            tokenSymbol: params.tokenSymbol,
            tokenAddress: params.tokenAddress,
            amountPaidRaw: params.amountPaidRaw,
            payTxHash: params.payTxHash,
            mode: params.mode,
            topic: params.topic,
            audience: params.audience,
            eventDescription: params.eventDescription,
            angle: params.angle,
            eventContext: params.eventContext,
          }),
          signal: abortRef.current.signal,
        });
      } catch (err: unknown) {
        clearSlowTimer();
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'network error';
        setState((s) => ({ ...s, fatal: msg, isDone: true, isSlow: false }));
        return;
      }

      if (!res.ok || !res.body) {
        clearSlowTimer();
        setState((s) => ({ ...s, fatal: `HTTP ${res.status}`, isDone: true, isSlow: false }));
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const chunks = buf.split('\n\n');
          buf = chunks.pop() ?? '';
          for (const chunk of chunks) {
            const line = chunk.replace(/^data: /, '').trim();
            if (!line) continue;
            try {
              apply(JSON.parse(line) as PipelineEvent);
            } catch {
              /* malformed chunk — ignore */
            }
          }
        }
      } catch (err: unknown) {
        clearSlowTimer();
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'stream interrupted';
        setState((s) => ({ ...s, fatal: msg, isDone: true, isSlow: false }));
      }
    },
    [apply, clearSlowTimer, armSlowTimer],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    clearSlowTimer();
    setState(initialState);
  }, [clearSlowTimer]);

  return { state, start, reset };
}

interface StartParams {
  threadId: bigint;
  chainId: number;
  walletAddress: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  tokenAddress: string;
  amountPaidRaw: string;
  payTxHash: string;
  mode: number;
  // Mode A
  topic?: string;
  audience?: 'beginner' | 'intermediate' | 'advanced';
  // Mode B
  eventDescription?: string;
  angle?: 'bullish' | 'bearish' | 'skeptical';
  eventContext?: EventContext | null;
}
