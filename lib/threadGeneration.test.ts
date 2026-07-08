import { describe, it, expect } from 'vitest';
import { initialState, applyEvent, type ThreadGenerationState } from './threadGeneration';

const slowed: ThreadGenerationState = { ...initialState, isSlow: true };

describe('threadGeneration.initialState', () => {
  it('starts not-slow, not-done, no fatal', () => {
    expect(initialState.isSlow).toBe(false);
    expect(initialState.isDone).toBe(false);
    expect(initialState.fatal).toBeNull();
    expect(initialState.tweets).toBeNull();
  });
});

describe('applyEvent — slow is advisory, never an outcome', () => {
  it('forward-progress events clear isSlow', () => {
    expect(applyEvent(slowed, { type: 'started' }).isSlow).toBe(false);
    expect(applyEvent(slowed, { type: 'step_started', step: 'groq' }).isSlow).toBe(false);
    expect(
      applyEvent(slowed, {
        type: 'step_settled',
        step: 'groq',
        txHash: '0xabc',
        costAmount: '1',
        tokenSymbol: 'cUSD',
      }).isSlow,
    ).toBe(false);
    expect(applyEvent(slowed, { type: 'step_output', step: 'groq', output: ['a'] }).isSlow).toBe(false);
  });

  it('step_failed leaves isSlow unchanged (not forward progress)', () => {
    expect(applyEvent(slowed, { type: 'step_failed', step: 'serper', error: 'x' }).isSlow).toBe(true);
  });

  it('done clears isSlow and never sets fatal', () => {
    const s = applyEvent(slowed, { type: 'done', totalCostUsd: '0.002' });
    expect(s.isSlow).toBe(false);
    expect(s.isDone).toBe(true);
    expect(s.totalCostUsd).toBe('0.002');
    expect(s.fatal).toBeNull();
  });

  it('fatal clears isSlow and sets fatal + isDone', () => {
    const s = applyEvent(slowed, { type: 'fatal', error: 'boom' });
    expect(s.isSlow).toBe(false);
    expect(s.fatal).toBe('boom');
    expect(s.isDone).toBe(true);
  });

  it("never produces fatal === 'slow' from any event", () => {
    for (const e of [
      { type: 'started' } as const,
      { type: 'step_started', step: 'groq' } as const,
      { type: 'done', totalCostUsd: '0' } as const,
    ]) {
      expect(applyEvent(initialState, e).fatal).not.toBe('slow');
    }
  });
});

describe('applyEvent — existing transitions still hold', () => {
  it('step_settled records txHash/cost/symbol', () => {
    const s = applyEvent(initialState, {
      type: 'step_settled',
      step: 'serper',
      txHash: '0xdead',
      costAmount: '1000',
      tokenSymbol: 'USDC',
      chainId: 8453,
    });
    expect(s.steps.serper).toMatchObject({
      status: 'settled',
      txHash: '0xdead',
      costAmount: '1000',
      tokenSymbol: 'USDC',
    });
    expect(s.steps.serper.chainId).toBe(8453);
  });

  it('step_output as array sets tweets', () => {
    const s = applyEvent(initialState, { type: 'step_output', step: 'groq', output: ['t1', 't2'] });
    expect(s.tweets).toEqual(['t1', 't2']);
  });

  it('step_output {final, tweets} sets tweets', () => {
    const s = applyEvent(initialState, {
      type: 'step_output',
      step: 'groq',
      output: { final: true, tweets: ['only'] },
    });
    expect(s.tweets).toEqual(['only']);
  });

  it('step_output without tweets is a no-op for tweets', () => {
    const s = applyEvent(initialState, { type: 'step_output', step: 'groq', output: { final: false } });
    expect(s.tweets).toBeNull();
  });

  it('does not mutate the previous state', () => {
    const prev = { ...initialState };
    applyEvent(prev, { type: 'step_started', step: 'groq' });
    expect(prev.steps.groq.status).toBe('pending');
  });
});
