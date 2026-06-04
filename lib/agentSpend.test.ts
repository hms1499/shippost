import { describe, it, expect } from 'vitest';
import { aggregateAgentSpend, type ThreadCostRow } from './agentSpend';

function row(p: Partial<ThreadCostRow>): ThreadCostRow {
  return {
    total_cost_usd: null,
    groq_tx_hash: null,
    serper_tx_hash: null,
    coingecko_tx_hash: null,
    fact_check_tx_hash: null,
    token_symbol: 'cUSD',
    ...p,
  };
}

describe('aggregateAgentSpend', () => {
  it('sums total_cost_usd and counts every non-null x402 tx hash', () => {
    const out = aggregateAgentSpend([
      row({ total_cost_usd: '0.001', groq_tx_hash: '0xa' }),
      row({
        total_cost_usd: '0.003',
        groq_tx_hash: '0xb',
        serper_tx_hash: '0xc',
        coingecko_tx_hash: '0xd',
        fact_check_tx_hash: '0xe',
      }),
    ]);
    expect(out.agentSpendUsd).toBe('0.0040');
    expect(out.x402CallCount).toBe(5);
  });

  it('counts coingecko settlements (regression: route previously omitted them)', () => {
    const out = aggregateAgentSpend([row({ coingecko_tx_hash: '0xfeed' })]);
    expect(out.x402CallCount).toBe(1);
  });

  it('treats null/garbage total_cost_usd as zero', () => {
    const out = aggregateAgentSpend([
      row({ total_cost_usd: null }),
      row({ total_cost_usd: 'not-a-number' }),
    ]);
    expect(out.agentSpendUsd).toBe('0.0000');
  });

  it('groups spend and thread counts by token, busiest first', () => {
    const out = aggregateAgentSpend([
      row({ token_symbol: 'cUSD', total_cost_usd: '0.001' }),
      row({ token_symbol: 'USDC', total_cost_usd: '0.002' }),
      row({ token_symbol: 'cUSD', total_cost_usd: '0.001' }),
    ]);
    expect(out.byToken).toEqual([
      { token: 'cUSD', threads: 2, spendUsd: '0.0020' },
      { token: 'USDC', threads: 1, spendUsd: '0.0020' },
    ]);
  });
});
