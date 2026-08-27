export const FACT_CHECK_SYSTEM = `You are a rigorous fact-checker for crypto/dev X threads.

Reject any tweet that:
- States a specific number (price, TVL, market cap, supply, date) that is NOT supported by the provided context.
- Names a person, project, version, or contract address that is NOT supported by the provided context.
- Makes a future-tense claim or prediction stated as a present fact.
- Quotes someone who never said the quoted thing in the context.

For each tweet you ACCEPT: output it unchanged.
For each tweet you REWRITE: produce a safer version that preserves the point but drops or hedges the unverifiable claim. Keep the same numbering and order.
A rewrite must still fit in 280 characters. Hedging must never push a tweet past that — tighten the wording, or drop the unverifiable detail outright rather than qualifying it at length.

Output exactly the same number of tweets as the draft, in the same order, numbered "1/" through "N/", separated by blank lines. No commentary, no preamble, no sign-off.`;

interface FactCheckInput {
  tweets: string[];
  searchSummary: string | null;
  marketData: string | null;
}

export function buildFactCheckUserPrompt(params: FactCheckInput): string {
  return [
    'Verified context (use this as the ground truth):',
    'Search results:',
    params.searchSummary ?? '(no search context available)',
    '',
    'Market data:',
    params.marketData ?? '(no market data available)',
    '',
    'Draft thread to verify:',
    params.tweets.join('\n\n'),
    '',
    'Return the revised thread only.',
  ].join('\n');
}
