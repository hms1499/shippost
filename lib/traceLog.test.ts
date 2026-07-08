import { describe, it, expect } from 'vitest';
import { appendTraceLines, type TraceLine } from './traceLog';
import { initialState, applyEvent } from './threadGeneration';

describe('appendTraceLines', () => {
  it('emits a run line when a step starts', () => {
    const next = applyEvent(initialState, { type: 'step_started', step: 'serper' });
    const lines = appendTraceLines([], initialState, next);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ glyph: 'run', key: 'serper:running' });
    expect(lines[0].text).toContain('serper');
  });

  it('emits an ok line with amount and tx on settle', () => {
    const running = applyEvent(initialState, { type: 'step_started', step: 'serper' });
    const settled = applyEvent(running, {
      type: 'step_settled', step: 'serper', txHash: '0xabc' as `0x${string}`,
      costAmount: '0.010', tokenSymbol: 'cUSD', chainId: 8453,
    });
    const lines = appendTraceLines(
      appendTraceLines([], initialState, running), running, settled,
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({
      glyph: 'ok', key: 'serper:settled', amount: '$0.010', txHash: '0xabc',
    });
    expect(lines[1].chainId).toBe(8453);
  });

  it('is idempotent — same transition twice adds nothing', () => {
    const next = applyEvent(initialState, { type: 'step_started', step: 'groq' });
    const once = appendTraceLines([], initialState, next);
    const twice = appendTraceLines(once, next, next);
    expect(twice).toHaveLength(1);
  });

  it('emits fail line with error text', () => {
    const running = applyEvent(initialState, { type: 'step_started', step: 'factCheck' });
    const failed = applyEvent(running, { type: 'step_failed', step: 'factCheck', error: 'timeout' });
    const lines = appendTraceLines([], running, failed);
    expect(lines[0]).toMatchObject({ glyph: 'fail', key: 'factCheck:failed' });
    expect(lines[0].text).toContain('timeout');
  });
});
