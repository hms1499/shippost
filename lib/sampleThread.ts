/**
 * A curated, hand-written sample thread shown as a read-only "specimen" on the
 * pre-connect landing page — so a first-time visitor sees the quality of the
 * output before connecting a wallet. Hot Take mode (it shows off the most:
 * live data + a fact-checked, opinionated voice). Hardcoded on purpose: always
 * reads well, no API dependency, no stored content.
 */
export const SAMPLE_THREAD = {
  mode: 'Hot Take',
  firstTweet:
    "The “ETF flows are dead” take is wrong. Spot BTC ETFs pulled $1.1B in net inflows last week — the 3rd-biggest haul since launch. The bears are reading the wrong chart. Here’s who’s actually buying 🧵",
  total: 5,
} as const;
