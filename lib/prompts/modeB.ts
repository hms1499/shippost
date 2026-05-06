import type { SerperOrganicResult } from '@/lib/pipeline/serperStep';

export type Angle = 'bullish' | 'bearish' | 'skeptical';

interface ModeBInput {
  eventDescription: string;
  angle: Angle;
  searchSummary: string | null;
  marketSnippet: string | null;
}

const ANGLE_BRIEF: Record<Angle, string> = {
  bullish:
    'Closing tweet rule (T(n)): one short verdict line in the form "net bullish on <event> because <signal>." Pick the single signal already on the table that, on net, supports a long-side position. No hedging, no DYOR, no "but". One sentence.',
  bearish:
    'Closing tweet rule (T(n)): one short verdict line in the form "net bearish on <event> because <signal>." Pick the single signal already on the table that, on net, supports a short-side position. No hedging, no DYOR, no "but". One sentence.',
  skeptical:
    'Closing tweet rule (T(n)): one evidence-test line in the form "what would change my mind: <observable signal>." The signal must be concrete, falsifiable, and specific — a number above/below a threshold, a named protocol shipping by a named date, a contract reaching a TVL level. No verdict, no fence-sitting prose, no "we will see". One sentence.',
};

const STRUCTURE = `Structure (signal-extraction body, angle only at the close):
- T1: hook framing the event in plain terms. No question opener. No "in this thread". No angle adjectives.
- T2: anchor signal — the single most verifiable fact about this event, drawn directly from the user description, search context, or market data.
- T3 ... T(n-1): additional signals. Each tweet does ONE of:
    (a) present a hard fact (named entity, number, date, contract, EIP, protocol)
    (b) draw a single light implication from a signal already on the table ("3 client teams committed → adoption pressure on the rest")
  No directional adjectives. Body must read as a neutral exposition of what is known, not a take.
- T(n): the only angle-specific tweet. Follow the closing rule for the chosen angle (see ANGLE).

Constraints:
- Only use facts that appear in the provided description, search context, or market context, or that are universally known. Never invent prices, dates, names, contracts, or numbers.
- Stay on the single event the user named. Do not drift into adjacent stories.
- Body tweets do not declare a side. Save the verdict / evidence-test for T(n).`;

const LENGTH_GUIDANCE = `Length: use as many tweets as the event needs to be argued well. Typical range is 5–9 tweets. Never fewer than 4. Never more than 10. Stop the moment the closing rule is satisfied; do not pad.`;

const FEW_SHOT_EXAMPLE = `Reference for voice and shape (different event — match the structure, do NOT copy content):

Sample event: Dencun upgrade activated on Ethereum mainnet, March 13 2024.
Sample search context:
- Dencun activated on Ethereum mainnet on March 13, 2024.
- EIP-4844 introduced "blob-carrying transactions" with a separate fee market.
- L2 user fees on Arbitrum, Optimism, and Base fell roughly 10x post-activation.
- Blob fee target is 3 blobs/block, max 6.
Sample market data: (none)
Sample angle: skeptical

<example_thread>
1/ Dencun activated on Ethereum mainnet on March 13, 2024 and changed how L2s post data to L1.

2/ Pre-Dencun, L2s settled calldata at the same gas market as everyone else. EIP-4844 introduced a separate blob fee market, target 3 blobs per block, max 6.

3/ In the days after activation, L2 user fees on Arbitrum, Optimism, and Base fell roughly 10x. Throughput limits on those L2s now scale with blob supply, not L1 calldata gas.

4/ Blob base fees have hovered near zero since launch — supply has run ahead of demand. The cost L2s pay for L1 data is currently not a meaningful ETH burn input.

5/ What would change my mind: a sustained stretch of more than two weeks where blob base fees stay non-zero and L2 throughput keeps climbing.
</example_thread>`;

export function buildModeBPrompt(input: ModeBInput): string {
  const blocks = [
    FEW_SHOT_EXAMPLE,
    `Now write a thread on:`,
    `Event: ${input.eventDescription.trim()}`,
    `Angle: ${input.angle}. ${ANGLE_BRIEF[input.angle]}`,
  ];

  if (input.searchSummary) {
    blocks.push(
      `Search context (use as ground truth — facts you cite must come from here):\n${input.searchSummary}`,
    );
  } else {
    blocks.push(`Search context: (none returned — keep claims general; do not invent specifics)`);
  }

  if (input.marketSnippet) {
    blocks.push(`Market data:\n${input.marketSnippet}`);
  }

  blocks.push(LENGTH_GUIDANCE);
  blocks.push(STRUCTURE);
  blocks.push('Output only the numbered tweets separated by blank lines. Nothing else.');

  return blocks.join('\n\n');
}

export function summarizeSerper(
  organic: SerperOrganicResult[],
  newsSnippet: string | null,
): string {
  const lines: string[] = [];
  if (newsSnippet) lines.push(`Top answer: ${newsSnippet}`);
  for (const r of organic.slice(0, 5)) {
    const when = r.date ? ` (${r.date})` : '';
    lines.push(`- ${r.title}${when}: ${r.snippet}`);
  }
  return lines.join('\n');
}

export function summarizeMarket(cg: {
  symbol: string | null;
  priceUsd: number | null;
  change24hPct: number | null;
  marketCapUsd: number | null;
}): string | null {
  if (!cg.symbol || cg.priceUsd === null) return null;
  const parts: string[] = [`${cg.symbol} @ $${cg.priceUsd.toPrecision(4)}`];
  if (cg.change24hPct !== null) parts.push(`${cg.change24hPct.toFixed(2)}% 24h`);
  if (cg.marketCapUsd) parts.push(`mcap ~$${(cg.marketCapUsd / 1e6).toFixed(1)}M`);
  return parts.join(', ');
}
