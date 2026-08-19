import { describe, it, expect } from 'vitest';
import { buildReceiptText, settledCalls, settledCostTotal } from './receiptText';
import type { StepState } from './threadGeneration';
import type { StepId } from './pipeline/types';

const steps: Record<StepId, StepState> = {
  serper: { status: 'settled', costAmount: '0.010', tokenSymbol: 'cUSD', txHash: '0xaaa' },
  coingecko: { status: 'settled', costAmount: '0.003', tokenSymbol: 'cUSD', txHash: '0xbbb' },
  groq: { status: 'settled', costAmount: '0.001', tokenSymbol: 'cUSD', txHash: '0xccc', chainId: 8453 },
  factCheck: { status: 'pending' },
};

describe('settledCostTotal', () => {
  it('sums the settled steps', () => {
    expect(settledCostTotal(steps)).toBe('0.014');
  });

  // A run that ended in `fatal` never gets a total from the stream, and the
  // receipt used to print a hardcoded '0.001' there. Zero settles means zero
  // spent — a real answer, unlike the constant.
  it('is 0.000 when nothing settled, rather than a made-up figure', () => {
    expect(
      settledCostTotal({
        serper: { status: 'failed' },
        coingecko: { status: 'pending' },
        groq: { status: 'running' },
        factCheck: { status: 'pending' },
      }),
    ).toBe('0.000');
  });

  it('ignores a settled step carrying no cost', () => {
    expect(
      settledCostTotal({
        ...steps,
        factCheck: { status: 'settled', txHash: '0xddd' },
      }),
    ).toBe('0.014');
  });
});

describe('settledCalls', () => {
  it('returns only settled steps, in pipeline order, with display labels', () => {
    const calls = settledCalls(steps);
    expect(calls.map((c) => c.label)).toEqual(['serper', 'coingecko', 'groq']);
    expect(calls[0]).toMatchObject({ costAmount: '0.010', txHash: '0xaaa' });
    expect(calls.find((c) => c.label === 'groq')).toMatchObject({ chainId: 8453 });
  });

  it('skips settled steps missing a cost so a malformed event never prints a blank row', () => {
    const bad = { ...steps, serper: { status: 'settled' } as StepState };
    expect(settledCalls(bad).map((c) => c.label)).toEqual(['coingecko', 'groq']);
  });

  it('filters 0x0 sentinel to undefined so the receipt does not link to a dead explorer URL', () => {
    const stepsWithSentinel: Record<StepId, StepState> = {
      serper: { status: 'settled', costAmount: '0.010', tokenSymbol: 'cUSD', txHash: '0x0' },
      coingecko: { status: 'settled', costAmount: '0.003', tokenSymbol: 'cUSD', txHash: '0xbbb' },
      groq: { status: 'settled', costAmount: '0.001', tokenSymbol: 'cUSD', txHash: '0xccc', chainId: 8453 },
      factCheck: { status: 'pending' },
    };
    const calls = settledCalls(stepsWithSentinel);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ label: 'serper', costAmount: '0.010' });
    expect(calls[0].txHash).toBeUndefined();
  });
});

describe('buildReceiptText', () => {
  const text = buildReceiptText({
    threadId: 4821n,
    paidAmountUsd: '0.050',
    // The agent's exact share, as splitPaidAmount computes it — not paid * 0.5.
    agentShareUsd: '0.025',
    tokenSymbol: 'cUSD',
    agentSpentUsd: '0.014',
    steps,
    payTxHash: '0xdeadbeef',
    explorerBase: 'https://celoscan.io',
    agentWalletAddress: '0x006cba3012139c299aa4a522697b4a0c49f38895',
  });

  it('leads with the machine header and thread number', () => {
    expect(text.startsWith('COINOP · receipt #4821')).toBe(true);
  });

  it('lists coin in, each settled x402 call, and agent p/l', () => {
    expect(text).toContain('coin in      $0.050 cUSD');
    expect(text).toContain('serper       $0.010');
    expect(text).toContain('coingecko    $0.003');
    expect(text).toContain('groq         $0.001');
    expect(text).not.toContain('factCheck');
    // p/l = the agent's share (0.025) minus 0.014 spent
    expect(text).toContain('agent p/l    +$0.011');
  });

  it('links the payment tx on the explorer', () => {
    expect(text).toContain('https://celoscan.io/tx/0xdeadbeef');
  });

  it('omits the tx line when there is no hash', () => {
    const noTx = buildReceiptText({
      threadId: null,
      paidAmountUsd: '0.050',
      agentShareUsd: '0.025',
      tokenSymbol: 'cUSD',
      agentSpentUsd: '0.014',
      steps,
      payTxHash: null,
      explorerBase: 'https://celoscan.io',
      agentWalletAddress: '0x006cba3012139c299aa4a522697b4a0c49f38895',
    });
    expect(noTx).not.toContain('/tx/');
    expect(noTx.startsWith('COINOP · receipt')).toBe(true);
  });
});
