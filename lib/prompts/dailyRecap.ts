interface DailyRecapInput {
  searchSummary: string | null;
  marketSnippet: string | null;
}

const STRUCTURE = `Structure (data-anchored recap, no personal take):
- T1: hook — the single defining number or story of the day, drawn from the market data or search context. No question opener. No "in this thread". No "GM".
- T2: the majors — where BTC and ETH stand today (price + 24h move) when the market data provides them.
- T3 ... T(n-1): the rest of the day. Each tweet does ONE of:
    (a) call out a notable mover from the market data (a top-10 coin with a standout 24h move, or a trending search)
    (b) relay one concrete news item from the search context (a listing, an unlock, a hack, a regulatory headline), attributed plainly
  One coin or one story per tweet. No directional adjectives, no advice.
- T(n): "one thing to watch" — a single concrete, observable item already on the table (a level, a pending decision, a dated event). No prediction, no verdict. One sentence.

Constraints:
- NEVER invent a price, percentage, market cap, date, or headline. Use ONLY figures and stories that appear in the market data or search context below. If a number is not provided, describe the move qualitatively instead.
- This is a neutral daily digest, not a take. No bullish/bearish framing, no "buy", no "DYOR".
- Plain words a casual reader follows; expand jargon on first use.`;

const LENGTH_GUIDANCE = `Length: use as many tweets as the day needs to be recapped well. Typical range is 5–8 tweets. Never fewer than 4. Never more than 10. Stop when the watch-item closes the thread; do not pad.`;

const FEW_SHOT_EXAMPLE = `Reference for voice and shape (different day — match the structure, do NOT copy content):

Sample market data:
Top 10 by market cap (price, 24h change):
BTC $61,200 (-2.1% 24h)
ETH $2,980 (-1.4% 24h)
SOL $142 (+4.8% 24h)
Trending searches: JUP, WIF
Sample search context:
- A major exchange announced a SOL staking product this morning.
- An Ethereum upgrade vote is scheduled for Thursday.

<example_thread>
1/ Crypto today: a red day for the majors while Solana runs the other way — SOL up 4.8% as the rest of the top 10 cools off.

2/ The majors: BTC trades at $61,200, down 2.1% on the day. ETH sits at $2,980, off 1.4%.

3/ The outlier is SOL at $142, +4.8%. The move lines up with a major exchange announcing a SOL staking product this morning.

4/ Search interest is rotating small: JUP and WIF lead trending searches, both Solana-ecosystem names.

5/ One thing to watch: the Ethereum upgrade vote scheduled for Thursday.
</example_thread>`;

export function buildDailyRecapPrompt(input: DailyRecapInput): string {
  const blocks = [FEW_SHOT_EXAMPLE, `Now write today's crypto market recap thread.`];

  if (input.marketSnippet) {
    blocks.push(
      `Market data (use as ground truth — every number you cite must come from here):\n${input.marketSnippet}`,
    );
  } else {
    blocks.push(
      `Market data: (none returned — do NOT state any price, market cap, or percentage; describe the day qualitatively from the search context)`,
    );
  }

  if (input.searchSummary) {
    blocks.push(`Search context (use as ground truth for news/stories):\n${input.searchSummary}`);
  } else {
    blocks.push(`Search context: (none returned — keep claims general; do not invent specifics)`);
  }

  blocks.push(LENGTH_GUIDANCE);
  blocks.push(STRUCTURE);
  blocks.push('Output only the numbered tweets separated by blank lines. Nothing else.');

  return blocks.join('\n\n');
}
