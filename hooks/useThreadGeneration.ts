'use client';

import { useCallback, useRef, useState } from 'react';
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
  totalCostUsd: string | null;
}

const initial: ThreadGenerationState = {
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
  totalCostUsd: null,
};

interface StartParams {
  threadId: bigint;
  topic: string;
  audience: 'beginner' | 'intermediate' | 'advanced';
  chainId: number;
  walletAddress: string;
  tokenSymbol: 'cUSD' | 'USDT' | 'USDC';
  tokenAddress: string;
  amountPaidRaw: string;
  payTxHash: string;
}

export function useThreadGeneration() {
  const [state, setState] = useState<ThreadGenerationState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  const apply = useCallback((e: PipelineEvent) => {
    setState((prev) => {
      switch (e.type) {
        case 'started':
          return { ...prev, hasStarted: true };
        case 'step_started': {
          const steps = { ...prev.steps };
          steps[e.step] = { ...steps[e.step], status: 'running' };
          return { ...prev, steps };
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
          return { ...prev, steps };
        }
        case 'step_failed': {
          const steps = { ...prev.steps };
          steps[e.step] = { ...steps[e.step], status: 'failed', error: e.error };
          return { ...prev, steps };
        }
        case 'step_output': {
          if (Array.isArray(e.output)) {
            return { ...prev, tweets: e.output as string[] };
          }
          if (e.output && typeof e.output === 'object') {
            const out = e.output as { final?: boolean; tweets?: string[] };
            if (out.final && Array.isArray(out.tweets)) {
              return { ...prev, tweets: out.tweets };
            }
          }
          return prev;
        }
        case 'done':
          return { ...prev, isDone: true, totalCostUsd: e.totalCostUsd };
        case 'fatal':
          return { ...prev, fatal: e.error, isDone: true };
      }
    });
  }, []);

  const start = useCallback(
    async (params: StartParams) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      setState(initial);

      let res: Response;
      try {
        res = await fetch('/api/generate/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: params.threadId.toString(),
            topic: params.topic,
            audience: params.audience,
            chainId: params.chainId,
            walletAddress: params.walletAddress,
            tokenSymbol: params.tokenSymbol,
            tokenAddress: params.tokenAddress,
            amountPaidRaw: params.amountPaidRaw,
            payTxHash: params.payTxHash,
          }),
          signal: abortRef.current.signal,
        });
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'network error';
        setState((s) => ({ ...s, fatal: msg, isDone: true }));
        return;
      }

      if (!res.ok || !res.body) {
        setState((s) => ({ ...s, fatal: `HTTP ${res.status}`, isDone: true }));
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
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : 'stream interrupted';
        setState((s) => ({ ...s, fatal: msg, isDone: true }));
      }
    },
    [apply],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(initial);
  }, []);

  return { state, start, reset };
}
