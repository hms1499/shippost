// Aggregates per-thread agent x402 spend for the public stats page. Pure:
// takes completed-thread rows and returns display-ready totals. `total_cost_usd`
// is stored as a string; non-numeric/null is treated as 0 so a bad row never
// poisons the total. Each non-null *_tx_hash is one settled x402 call.
export interface ThreadCostRow {
  total_cost_usd: string | null;
  groq_tx_hash: string | null;
  serper_tx_hash: string | null;
  coingecko_tx_hash: string | null;
  fact_check_tx_hash: string | null;
  token_symbol: string;
}

export interface TokenSpend {
  token: string;
  threads: number;
  spendUsd: string;
}

export interface AgentSpendAggregate {
  agentSpendUsd: string;
  x402CallCount: number;
  byToken: TokenSpend[];
}

export function aggregateAgentSpend(rows: ThreadCostRow[]): AgentSpendAggregate {
  let totalSpend = 0;
  let calls = 0;
  const tokenMap = new Map<string, { threads: number; spend: number }>();

  for (const r of rows) {
    const parsed = r.total_cost_usd ? Number(r.total_cost_usd) : 0;
    const spend = Number.isFinite(parsed) ? parsed : 0;
    totalSpend += spend;
    calls +=
      (r.groq_tx_hash ? 1 : 0) +
      (r.serper_tx_hash ? 1 : 0) +
      (r.coingecko_tx_hash ? 1 : 0) +
      (r.fact_check_tx_hash ? 1 : 0);
    const t = tokenMap.get(r.token_symbol) ?? { threads: 0, spend: 0 };
    t.threads += 1;
    t.spend += spend;
    tokenMap.set(r.token_symbol, t);
  }

  const byToken = Array.from(tokenMap.entries())
    .map(([token, v]) => ({ token, threads: v.threads, spendUsd: v.spend.toFixed(4) }))
    .sort((a, b) => b.threads - a.threads);

  return {
    agentSpendUsd: totalSpend.toFixed(4),
    x402CallCount: calls,
    byToken,
  };
}
