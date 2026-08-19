'use client';

import { useEffect, useState } from 'react';
import type { PaidRun } from '@/lib/paidRun';
import {
  fetchThreadRow,
  interpretThreadRow,
  RESUME_CEILING_MS,
  RESUME_POLL_MS,
  type ResumeState,
} from '@/lib/resumeRun';

/**
 * Polls one thread row until it resolves. Read-only by construction: there is
 * no code path here that starts a generation.
 *
 * `run` must be referentially stable — hold it in state, not in a literal, or
 * every render restarts the poll.
 */
export function useResumeRun(run: PaidRun | null): ResumeState {
  const [state, setState] = useState<ResumeState>({ state: 'checking' });

  useEffect(() => {
    if (!run) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();
    const deadline = Date.now() + RESUME_CEILING_MS;

    async function tick() {
      if (cancelled) return;
      const row = await fetchThreadRow(
        run!.chainId,
        run!.threadId,
        run!.wallet,
        controller.signal,
      );
      if (cancelled) return;

      const next = interpretThreadRow(row);
      if (next.state !== 'checking') {
        setState(next);
        return;
      }
      // Still nothing. Give up only at the ceiling, and say so as 'gone' rather
      // than spinning forever at a user who has already paid.
      if (Date.now() >= deadline) {
        setState({ state: 'gone' });
        return;
      }
      setState(next);
      timer = setTimeout(tick, RESUME_POLL_MS);
    }

    void tick();
    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [run]);

  return state;
}
