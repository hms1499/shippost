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
    'You are bullish. Lead with the most important positive implication that the consensus is missing or underweighting. Back it with a specific fact or number from the provided context. Acknowledge the strongest bear argument in one line, then explain why it does not change the picture.',
  bearish:
    'You are bearish. Lead with the most important risk or flaw that is being downplayed. Back it with a specific fact or number from the provided context. Acknowledge what bulls get right in one line, then explain why it does not change the picture.',
  skeptical:
    'You are skeptical. Do not pick a side. Frame what is actually known vs assumed, ask the questions a professional investor would ask before getting excited, and end with the specific evidence that would move you off the fence.',
};

const STRUCTURE = `Structure (ONE event, ONE angle — narrative, not bullet list):
- Tweet 1: hook framing the event in plain terms. No question opener. No "in this thread". No preamble.
- Tweet 2: anchor with a specific verifiable fact or number drawn directly from the provided context. This is the foundation; everything later must be consistent with it.
- Middle tweets: develop the angle step-by-step. Each tweet picks up where the previous left off, builds the argument, and stays grounded in the context. One idea per tweet.
- Second-last tweet: a falsifiable prediction with a caveat ("if X, then Y"), OR for the skeptical angle, the specific evidence that would change your mind.
- Last tweet: a single closing observation. No CTA, no DYOR, no "follow for more", no question to drive replies.

Constraints:
- Only use facts that appear in the provided search/market context, or that are universally known. Never invent prices, dates, names, contracts, or numbers.
- Do not introduce a new sub-event mid-thread. Stay on the single event the user named.`;

const LENGTH_GUIDANCE = `Length: use as many tweets as the event needs to be argued well. Typical range is 5–9 tweets. Never fewer than 4. Never more than 10. Stop the moment the angle is fully expressed; do not pad.`;

const FEW_SHOT_EXAMPLE = `Reference for voice and quality bar (different event and angle — match the style, do NOT copy content):

Sample search context:
- Dencun upgrade activated on Ethereum mainnet on March 13, 2024.
- The upgrade introduced EIP-4844 "blob-carrying transactions" for L2 data availability.
- L2 user fees on Arbitrum, Optimism, and Base dropped roughly 10x in the days following activation.
- Blob fee market is independent of execution gas; target is 3 blobs/block, max 6.

Sample market data: (none — pre-token-event posts often have no market snippet)

Sample angle: skeptical

<example_thread>
1/ Dencun made L2 fees cheap. Whether that translates to ETH revenue or an L2 free lunch depends on numbers nobody is publishing yet.

2/ Before Dencun, L2s posted calldata to L1 at gas-market rates. After March 2024 they post blobs in a separate fee market. L2 user fees fell roughly 10x.

3/ The bull thesis: more L2 throughput leads to more blob demand, which burns more ETH. The skeptic question: blob base fees have hovered near zero because supply (3 target, 6 max per block) outruns demand.

4/ Dencun is clearly a UX win for L2 users. Whether it becomes a revenue win for L1 holders is an open data question, not a settled thesis.

5/ The check I want before getting bullish: a sustained stretch where blob base fees stay non-zero and L2 throughput keeps climbing. Until then, Dencun is the cheap call option neither side has paid for.
</example_thread>`;

export function buildModeBPrompt(input: ModeBInput): string {
  const blocks = [
    FEW_SHOT_EXAMPLE,
    `Now write a thread on:`,
    `Event: ${input.eventDescription.trim()}`,
    `Angle: ${input.angle}. ${ANGLE_BRIEF[input.angle]}`,
  ];

  if (input.searchSummary) {
    blocks.push(`Search context (use as ground truth — facts you cite must come from here):\n${input.searchSummary}`);
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
