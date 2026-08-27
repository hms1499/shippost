// Chain-vs-chain comparison mode (id 4). One whitelist drives both server-side
// validation and the client dropdown. `defiLlamaName` MUST equal the exact
// `name` field DefiLlama's /v2/chains returns, or TVL won't resolve.
export interface ChainEntry {
  key: string; // stable machine key, used in the `topic` wire value
  label: string; // display name in the UI + prompt
  defiLlamaName: string; // exact /v2/chains name
}

export const CHAINS: ChainEntry[] = [
  { key: 'ethereum', label: 'Ethereum', defiLlamaName: 'Ethereum' },
  { key: 'solana', label: 'Solana', defiLlamaName: 'Solana' },
  { key: 'base', label: 'Base', defiLlamaName: 'Base' },
  { key: 'arbitrum', label: 'Arbitrum', defiLlamaName: 'Arbitrum' },
  { key: 'optimism', label: 'Optimism', defiLlamaName: 'OP Mainnet' },
  { key: 'polygon', label: 'Polygon', defiLlamaName: 'Polygon' },
  { key: 'bsc', label: 'BNB Chain', defiLlamaName: 'BSC' },
  { key: 'avalanche', label: 'Avalanche', defiLlamaName: 'Avalanche' },
  { key: 'sui', label: 'Sui', defiLlamaName: 'Sui' },
  { key: 'aptos', label: 'Aptos', defiLlamaName: 'Aptos' },
  { key: 'tron', label: 'Tron', defiLlamaName: 'Tron' },
  { key: 'celo', label: 'Celo', defiLlamaName: 'Celo' },
  { key: 'blast', label: 'Blast', defiLlamaName: 'Blast' },
  { key: 'zksync', label: 'zkSync Era', defiLlamaName: 'ZKsync Era' },
];

export const CHAIN_BY_KEY: Record<string, ChainEntry> = Object.fromEntries(
  CHAINS.map((c) => [c.key, c]),
);

// Decode the two chains carried in the request `topic` field ("solana|base").
// Returns null (→ 400 upstream) on anything malformed: wrong arity, unknown
// key, or the same chain twice.
export function parseChains(topic: string | undefined): [ChainEntry, ChainEntry] | null {
  if (!topic) return null;
  const parts = topic.split('|').map((s) => s.trim().toLowerCase());
  if (parts.length !== 2) return null;
  const [aKey, bKey] = parts;
  if (aKey === bKey) return null;
  const a = CHAIN_BY_KEY[aKey];
  const b = CHAIN_BY_KEY[bKey];
  if (!a || !b) return null;
  return [a, b];
}

export function serperQueryFor(aLabel: string, bLabel: string): string {
  return `${aLabel} vs ${bLabel} blockchain ecosystem TVL activity growth 2026`;
}

const STRUCTURE = `Structure:
- T1: hook — frame the matchup and state, in the opening tweet, which chain wins.
- T2..T(n-2): the case for the winner — one comparative signal per tweet (TVL, 7d TVL momentum, ecosystem activity from the search context). Every number MUST come from the data below.
- T(n-1): the loser's genuine strength — one honest tweet on where the losing chain is ahead or catching up. This is required; it keeps the thread analysis, not shilling.
- T(n): "one thing to watch" for the loser — a concrete, observable signal that would flip the verdict.

Constraints:
- Pick exactly ONE winner and never waffle back on it.
- Do not invent a TVL figure, percentage, or ranking. Use ONLY numbers in the chain data / search context below. If a number isn't provided, argue qualitatively.
- Compare the two named chains only. Don't drift into a third chain unless the search context ties it directly to this matchup.`;

const LENGTH_GUIDANCE = `Length: 5–9 tweets. Never fewer than 4, never more than 10. Stop once the verdict, the loser's strength, and the watch-signal are all covered.`;

// Comparison was the only mode with no worked example, and it showed: across
// three real runs its tweet length swung from a 52-char opener ("Base beats
// Celo on every measurable metric today.") to a steady ~170, because nothing
// anchored the shape. Same role as every other mode's example — voice and
// structure, never content.
const FEW_SHOT_EXAMPLE = `Reference for voice and shape (different matchup — match the structure, do NOT copy content):

Sample matchup: Optimism vs Arbitrum
Sample chain data:
Arbitrum: TVL $18.2B, 30d change +9.1%
Optimism: TVL $7.6B, 30d change -2.4%
Sample search context:
- Arbitrum has led all L2s in daily active addresses for three straight months.
- Base, World and several others run on the OP Stack.

<example_thread>
1/ Optimism vs Arbitrum on today's data is not close: Arbitrum wins. It holds roughly 2.4x the TVL, and the gap widened over the last 30 days rather than closing, which is the part that decides it.

2/ TVL is the blunt measure and Arbitrum leads it $18.2B to $7.6B. Size alone would be a weak argument if it were static, but the direction is what makes it hold up as the opening claim.

3/ Momentum points the same way. Arbitrum TVL is up 9.1% over 30 days while Optimism is down 2.4%, so the leader is compounding its lead instead of coasting on a head start it built earlier.

4/ Ecosystem activity backs the number. Arbitrum has led all L2s in daily active addresses for three straight months, which means the TVL is being used rather than parked by a handful of large depositors.

5/ Optimism's genuine strength is the Superchain. Base, World and several others run on the OP Stack, so its code settles far more activity than its own TVL line shows, and that is a real distribution advantage.

6/ One thing to watch for Optimism: whether Superchain revenue starts landing on OP itself. If sequencer fees from the chains built on its stack begin accruing to the token, the TVL comparison stops being the right measure.
</example_thread>`;

export function buildComparisonPrompt(input: {
  aLabel: string;
  bLabel: string;
  chainData: string | null;
  searchSummary: string | null;
}): string {
  const blocks = [
    FEW_SHOT_EXAMPLE,
    `Write an X thread comparing two blockchains and pick a single winner: ${input.aLabel} vs ${input.bLabel}.`,
  ];

  if (input.chainData) {
    blocks.push(`Chain data (ground truth — every number you cite must come from here):\n${input.chainData}`);
  } else {
    blocks.push(`Chain data: (none returned — do NOT state any TVL number or percentage; make the call qualitatively from the search context and general knowledge)`);
  }

  if (input.searchSummary) {
    blocks.push(`Search context (ground truth for ecosystem activity / narrative):\n${input.searchSummary}`);
  } else {
    blocks.push(`Search context: (none returned — keep claims general; do not invent specifics)`);
  }

  blocks.push(LENGTH_GUIDANCE);
  blocks.push(STRUCTURE);
  blocks.push('Output only the numbered tweets separated by blank lines. Nothing else.');
  return blocks.join('\n\n');
}
