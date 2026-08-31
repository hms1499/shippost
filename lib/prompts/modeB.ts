import type { SerperOrganicResult } from '@/lib/pipeline/serperStep';
import type { CoinGeckoResult } from '@/lib/pipeline/coingeckoStep';

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
- T1: hook (see HOOK) — frame the event through its single sharpest verifiable fact or tension. A specific question is allowed. No "in this thread". No angle adjectives.
- T2: anchor signal — the single most verifiable fact about this event, drawn directly from the user description, search context, or market data.
- T3 ... T(n-1): additional signals. Each tweet takes a hard fact (named entity, number, date, contract, EIP, protocol) AND says what it means: the consequence, the trade-off, or the tension with a signal already on the table. "3 client teams committed, which puts the remaining two on a schedule they did not pick."
  A tweet that only restates a fact is not finished. Reciting the inputs back in sentences is the failure mode this body falls into, and it is the most common one.
  No directional adjectives. Interpretation is NOT a side: say what a signal implies mechanically, never whether it is good or bad, and never where the price goes.
- T(n): the only angle-specific tweet. Follow the closing rule for the chosen angle (see ANGLE).

Constraints:
- Only use facts that appear in the provided description, search context, or market context, or that are universally known. Never invent prices, dates, names, contracts, or numbers.
- That constraint covers the interpretations too. Reason FROM the facts you were given; never reach for a new number, date or name to prop up a point. If what you have cannot support the implication, drop the implication — never the accuracy.
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
1/ Dencun activated on Ethereum mainnet on March 13, 2024. It did not touch throughput or proving. It changed where L2s put their data and what that data costs them, and every L2 fee number since then follows from that one move.

2/ Before Dencun, L2s posted calldata into the same gas market as every swap and mint on L1, so they bid against ordinary users for blockspace. EIP-4844 gave them a separate blob fee market, target 3 blobs per block, hard cap 6.

3/ In the days after activation, user fees on Arbitrum, Optimism and Base fell roughly 10x. The ceiling on those L2s now moves with blob supply rather than with L1 calldata gas. That is a different constraint with a different failure mode.

4/ The caveat is that blob base fees have sat near zero since launch, because supply has run ahead of demand. The data L2s buy from L1 is currently not a meaningful ETH burn input, so the saving is a subsidy nobody has had to price yet.

5/ What would change my mind: a sustained stretch of more than two weeks where blob base fees stay non-zero and L2 throughput keeps climbing anyway. That would show the demand is real and not an artifact of cheap early blockspace.
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

function signedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}

// Compact USD: $4.45B / $312.0M / $28.4K. Keeps the snippet short so the model
// spends its attention on the signal, not on parsing long numbers.
function usdCompact(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// Turn the CoinGecko snapshot into researcher-grade ground truth: not just a
// price line, but momentum across windows, liquidity, dilution headroom, and
// distance from the all-time high. Each line is a signal the thread can cite.
export function summarizeMarket(cg: CoinGeckoResult): string | null {
  if (!cg.symbol || cg.priceUsd === null) return null;
  const lines: string[] = [];

  const head = [`${cg.symbol} @ $${cg.priceUsd.toPrecision(4)}`];
  if (cg.marketCapRank) head.push(`rank #${cg.marketCapRank}`);
  lines.push(head.join(', '));

  const momentum: string[] = [];
  if (cg.change24hPct !== null) momentum.push(`24h ${signedPct(cg.change24hPct)}`);
  if (cg.change7dPct !== null) momentum.push(`7d ${signedPct(cg.change7dPct)}`);
  if (cg.change30dPct !== null) momentum.push(`30d ${signedPct(cg.change30dPct)}`);
  if (momentum.length) lines.push(`Momentum: ${momentum.join(', ')}`);

  const size: string[] = [];
  if (cg.marketCapUsd) size.push(`mcap ${usdCompact(cg.marketCapUsd)}`);
  if (cg.volume24hUsd) {
    size.push(`24h vol ${usdCompact(cg.volume24hUsd)}`);
    if (cg.marketCapUsd) size.push(`vol/mcap ${(cg.volume24hUsd / cg.marketCapUsd).toFixed(2)}`);
  }
  if (size.length) lines.push(`Size & liquidity: ${size.join(', ')}`);

  if (cg.circulatingSupply && cg.maxSupply) {
    const inCirc = (cg.circulatingSupply / cg.maxSupply) * 100;
    lines.push(
      `Supply: ${inCirc.toFixed(0)}% of max in circulation, ${(100 - inCirc).toFixed(0)}% still to unlock`,
    );
  } else if (cg.circulatingSupply && cg.maxSupply === null) {
    lines.push(`Supply: uncapped (no fixed max)`);
  }

  if (cg.athChangePct !== null && cg.athChangePct < 0) {
    lines.push(`Down ${Math.abs(cg.athChangePct).toFixed(0)}% from all-time high`);
  }

  return lines.join('\n');
}
