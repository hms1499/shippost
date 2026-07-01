import type { Angle } from '@/lib/prompts/modeB';

interface TokenAnalysisInput {
  ticker: string; // already normalised, e.g. "$CELO"
  angle: Angle;
  searchSummary: string | null;
  marketSnippet: string | null;
}

// Normalise free user input into a single $cashtag the CoinGecko step can
// resolve: uppercase, one leading "$", letters/digits only, 2–6 chars of body.
// "celo" -> "$CELO", " $btc " -> "$BTC", "ETH/USD" -> "$ETH". Returns "$" when
// nothing usable is found (the pipeline then runs with no market data).
export function normalizeTicker(raw: string): string {
  const body = raw
    .trim()
    .replace(/^\$+/, '')
    .toUpperCase()
    .replace(/[^A-Z0-9].*$/, '') // cut at first non-alphanumeric (e.g. "ETH/USD")
    .slice(0, 6);
  return `$${body}`;
}

const ANGLE_CLOSE: Record<Angle, string> = {
  bullish:
    'Closing tweet rule (T(n)): one short verdict line in the form "net bullish on <ticker> because <signal>." Pick the single signal already on the table that, on net, supports a long position. No hedging, no DYOR, no "but". One sentence.',
  bearish:
    'Closing tweet rule (T(n)): one short verdict line in the form "net bearish on <ticker> because <signal>." Pick the single signal already on the table that, on net, supports a short position. No hedging, no DYOR, no "but". One sentence.',
  skeptical:
    'Closing tweet rule (T(n)): one evidence-test line in the form "what would change my mind: <observable signal>." The signal must be concrete and falsifiable — a price above/below a level, a TVL or volume threshold, a named unlock/listing by a named date. No verdict, no fence-sitting prose. One sentence.',
};

const STRUCTURE = `Structure (data-anchored body, angle only at the close):
- T1: hook (see HOOK) — name the token (what it is / what it does) through its most striking real number or contradiction, anchored to the market data. A specific question is allowed. No "in this thread". No angle adjectives.
- T2: anchor signal — the single most verifiable fact: market cap, price, or the token's core function. Draw it directly from the market data or search context.
- T3 ... T(n-1): additional signals. Each tweet does ONE of:
    (a) present a hard fact (24h move, a recent catalyst/listing/unlock, a named partner, a TVL or volume figure) drawn from the market data or search context
    (b) draw a single light implication from a signal already on the table ("supply unlock next month → sell pressure into a thin book")
  No directional adjectives in the body. It must read as a neutral exposition of what is known, not a take.
- T(n): the only angle-specific tweet. Follow the closing rule for the chosen angle (see ANGLE).

Constraints:
- NEVER invent a price, market cap, percentage, date, partner, or number. Use ONLY figures that appear in the market data or search context below. If a number is not provided, do not state one — describe the dynamic qualitatively instead.
- Stay on the single token named. Do not drift into adjacent tokens or the broader market unless the search context ties them directly to this token.
- Body tweets do not declare a side. Save the verdict / evidence-test for T(n).`;

const LENGTH_GUIDANCE = `Length: use as many tweets as the token needs to be argued well. Typical range is 5–9 tweets. Never fewer than 4. Never more than 10. Stop the moment the closing rule is satisfied; do not pad.`;

const FEW_SHOT_EXAMPLE = `Reference for voice and shape (different token — match the structure, do NOT copy content):

Sample ticker: $UNI
Sample market data:
$UNI @ $7.420, rank #22
Momentum: 24h -3.1%, 7d +5.2%, 30d -11.0%
Size & liquidity: mcap $4.45B, 24h vol $310.0M, vol/mcap 0.07
Supply: 75% of max in circulation, 25% still to unlock
Down 68% from all-time high
TVL $4.20B, Dexes (Uniswap on DefiLlama), mcap/TVL 1.06, TVL 7d -2.0%
Sample search context:
- Uniswap is the largest decentralized exchange by volume on Ethereum.
- A "fee switch" governance proposal to turn on protocol fees has been debated repeatedly since 2022.
- UNI is a governance token; holders vote but do not currently receive protocol revenue.
Sample angle: skeptical

<example_thread>
1/ $UNI is the governance token of Uniswap, the largest onchain exchange by volume on Ethereum. It trades around $7.42 today, a market cap near $4.45B.

2/ The token's job is narrow: UNI votes on governance. It does not, as of today, route any protocol revenue to holders.

3/ That gap is the whole UNI debate. A "fee switch" — turning on protocol fees and directing them to the DAO or stakers — has been proposed repeatedly since 2022 and has not shipped.

4/ The market prices UNI at roughly the capital in the protocol: $4.45B cap against $4.2B TVL, an mcap/TVL near 1.06. The governance premium is thin.

5/ Only 75% of max supply is circulating. The remaining 25% is a standing dilution overhang for any long-term holder.

6/ What would change my mind: a fee switch passing governance with a concrete on-date and a defined split to UNI holders.
</example_thread>`;

export function buildTokenAnalysisPrompt(input: TokenAnalysisInput): string {
  const ticker = input.ticker.trim();
  const blocks = [
    FEW_SHOT_EXAMPLE,
    `Now write a thread analysing the token:`,
    `Ticker: ${ticker}`,
    `Angle: ${input.angle}. ${ANGLE_CLOSE[input.angle]}`,
  ];

  if (input.marketSnippet) {
    blocks.push(`Market data (use as ground truth — every number you cite must come from here):\n${input.marketSnippet}`);
  } else {
    blocks.push(`Market data: (none returned — do NOT state any price, market cap, or percentage; argue qualitatively)`);
  }

  if (input.searchSummary) {
    blocks.push(`Search context (use as ground truth for catalysts/news):\n${input.searchSummary}`);
  } else {
    blocks.push(`Search context: (none returned — keep claims general; do not invent specifics)`);
  }

  blocks.push(LENGTH_GUIDANCE);
  blocks.push(STRUCTURE);
  blocks.push('Output only the numbered tweets separated by blank lines. Nothing else.');

  return blocks.join('\n\n');
}
