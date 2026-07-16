// Prompt for News Breakdown (mode 5): a NEUTRAL explainer of one specific news
// item. Unlike Mode B there is no angle — the thread never picks a side. The
// neutrality ban list below is mode-local on purpose: words like "bullish" are
// the whole point of Hot Take, so they must never enter lib/bannedPhrases.ts.

interface NewsBreakdownInput {
  event: string;
  searchSummary: string | null;
  marketSnippet: string | null;
}

const STRUCTURE = `Structure (neutral breakdown, four beats in order):
- T1 — what just happened: the single hardest fact of the news (who did what, number, date). Cite the source host in parentheses when one appears in the news line. No question hooks, no "in this thread".
- T2 onward — why it matters: the mechanism or context that makes this consequential. Hard facts only.
- next — who is affected + numbers: named projects, chains, holder groups; cite market data when provided.
- T(n) — what to watch next: 1–2 concrete, observable follow-ups (a date, a vote, a threshold, an unlock). Not advice, not a verdict.

Neutrality rules (hard requirements):
- Never pick a side. Banned words and framings: bullish, bearish, moon, dump, pump, send it, "good/bad for price", buy, sell, long, short, accumulate.
- No investment recommendation of any kind.
- Separate fact from inference: facts come only from the news line, search context, or market data. Any inference must be marked "likely" or "could" and follow from a stated fact.
- Stay on this single news item. Do not drift into adjacent stories.`;

const LENGTH_GUIDANCE = `Length: 5–8 tweets. Never fewer than 4, never more than 9. Stop when the "what to watch" beat is delivered; do not pad.`;

const FEW_SHOT_EXAMPLE = `Reference for voice and shape (different news — match the structure, do NOT copy content):

Sample news: Circle launched native USDC on Celo on April 30, 2024, replacing bridged USDC.e (source: circle.com)
Sample search context:
- Circle announced native USDC issuance on Celo on April 30, 2024.
- Bridged USDC.e on Celo will migrate to native USDC via Portal.
- Celo fee abstraction lets users pay gas in stablecoins.
Sample market data: (none)

<example_thread>
1/ Circle launched native USDC on Celo on April 30, 2024 (circle.com). Until now, USDC on Celo was a bridged asset, USDC.e.

2/ Native issuance means Circle mints and redeems directly on Celo — no bridge in the redemption path, which is where bridged stablecoins carry their extra trust assumptions.

3/ Holders of bridged USDC.e are affected first: Portal is coordinating a migration to the native token. Apps quoting USDC.e liquidity will need to re-point pools and price feeds.

4/ Celo's fee abstraction already lets users pay gas in stablecoins, so native USDC slots directly into the fee path wallets like MiniPay use.

5/ What to watch: the migration deadline for USDC.e, and whether native USDC liquidity on Celo DEXes overtakes the bridged pools in the weeks after.
</example_thread>`;

export function buildNewsBreakdownPrompt(input: NewsBreakdownInput): string {
  const blocks = [
    FEW_SHOT_EXAMPLE,
    `Now write a neutral breakdown thread on this news:`,
    `News: ${input.event.trim()}`,
  ];

  if (input.searchSummary) {
    blocks.push(
      `Search context (ground truth — facts you cite must come from here):\n${input.searchSummary}`,
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
