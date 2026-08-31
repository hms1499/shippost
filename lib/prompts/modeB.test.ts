import { describe, it, expect } from 'vitest';
import { buildModeBPrompt, summarizeMarket, turnoverPhrase, dilutionPhrase } from './modeB';

const baseInput = {
  eventDescription: 'Vitalik posted a draft EIP for encrypted mempools.',
  searchSummary: '- Draft EIP discusses commit-reveal mempool scheme.',
  marketSnippet: 'ETH @ $3120, +1.4% 24h',
};

describe('buildModeBPrompt — body structure (angle-agnostic)', () => {
  it('instructs neutral signal extraction in body tweets', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    // Body must surface signals (facts / light implications) without verdict adjectives.
    expect(out).toMatch(/signal/i);
    expect(out).toMatch(/no directional adjectives/i);
  });

  it('caps thread length to the existing 4–10 floor/ceiling', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'skeptical' });
    expect(out).toMatch(/Never fewer than 4/);
    expect(out).toMatch(/Never more than 10/);
  });

  it('reminds the model to cite only facts in context', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bearish' });
    expect(out).toMatch(/Never invent|only use facts/i);
  });

  it('passes the user description and search/market context through', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    expect(out).toContain(baseInput.eventDescription);
    expect(out).toContain('commit-reveal mempool scheme');
    expect(out).toContain('ETH @ $3120');
  });
});

describe('buildModeBPrompt — angle-specific close', () => {
  it('bullish close instructs a 1-line net-bullish verdict', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    expect(out).toMatch(/net bullish/i);
    expect(out).toMatch(/no hedging/i);
  });

  it('bearish close instructs a 1-line net-bearish verdict', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bearish' });
    expect(out).toMatch(/net bearish/i);
    expect(out).toMatch(/no hedging/i);
  });

  it('skeptical close instructs a concrete evidence-test, not a verdict', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'skeptical' });
    expect(out).toMatch(/what would change my mind|evidence/i);
    expect(out).toMatch(/falsifiable|specific|concrete/i);
  });
});

describe('buildModeBPrompt — hook', () => {
  it('invites a hook and drops the question-opener ban, keeps neutral body', () => {
    const out = buildModeBPrompt({ ...baseInput, angle: 'bullish' });
    expect(out).toMatch(/hook/i);
    expect(out).not.toMatch(/No question opener/i);
    expect(out).toMatch(/No angle adjectives/i);
  });
});

describe('buildModeBPrompt — the body has to interpret, not recite', () => {
  // Sampling mode 1 and mode 2 on 2026-08-31 produced threads that were correct
  // and told the reader nothing: the CELO thread was summarizeMarket() read back
  // as sentences, and the Base-sequencer thread never said what the revenue did.
  // That was the prompt working as written. STRUCTURE allowed a body tweet to
  // "draw a single LIGHT implication" and required the body to "read as a
  // neutral exposition of what is known, not a take" — a summarizer by spec.
  //
  // The conflation to keep undone: taking a SIDE belongs at T(n) and nowhere
  // else, but INTERPRETING a signal is not taking a side, and banning both is
  // what made the body generic.
  const prompt = () =>
    buildModeBPrompt({
      eventDescription: 'Base sequencer revenue fell sharply after Dencun',
      angle: 'skeptical',
      searchSummary: '- Dencun activated on March 13, 2024.',
      marketSnippet: null,
    });

  it('requires each body tweet to say what its fact means', () => {
    expect(prompt()).toMatch(/AND says what it means/);
  });

  it('names reciting the inputs back as the failure mode', () => {
    expect(prompt()).toMatch(/only restates a fact is not finished/);
  });

  it('no longer settles for a "light" implication or a neutral exposition', () => {
    const out = prompt();
    expect(out).not.toMatch(/single light implication/);
    expect(out).not.toMatch(/neutral exposition of what is known/);
  });

  it('still confines the side to the closing tweet', () => {
    const out = prompt();
    expect(out).toMatch(/Interpretation is NOT a side/);
    expect(out).toMatch(/Body tweets do not declare a side/);
  });

  // The risk this change carries: licensing interpretation invites inventing a
  // number to support one. The anti-fabrication constraint has to reach the
  // interpretations, not just the facts.
  it('extends the no-invented-numbers rule to the interpretations', () => {
    expect(prompt()).toMatch(/covers the interpretations too/);
    expect(prompt()).toMatch(/drop the implication — never the accuracy/);
  });
});

describe('turnoverPhrase / dilutionPhrase — the arithmetic the model got wrong', () => {
  // These exist because licensing interpretation (see the block above) bought a
  // new failure: the model started deriving figures, and got 4 of 7 wrong in
  // one sampled batch. The worst was reading vol/mcap 0.31 as "turns over three
  // times per day" — the reciprocal, off by ~9x — while getting 0.12 and 0.18
  // right in the same run. Same arithmetic either way; this version has tests.
  it('inverts vol/mcap into a period, the direction the model reversed', () => {
    // vol/mcap 0.31 => once every ~3.2 days, NOT three times a day.
    expect(turnoverPhrase(46_100_000, 14_100_000)).toBe(
      'the whole cap changes hands about once every 3.3 days',
    );
  });

  it('matches the two the model happened to get right', () => {
    expect(turnoverPhrase(576_700_000, 66_300_000)).toMatch(/once every 8\.7 days/); // ARB, vol/mcap 0.12
    expect(turnoverPhrase(200_300_000, 36_200_000)).toMatch(/once every 5\.5 days/); // OP, vol/mcap 0.18
  });

  it('switches to a per-day rate when the float turns over faster than daily', () => {
    expect(turnoverPhrase(100_000_000, 250_000_000)).toBe('the whole cap changes hands about 2.5x per day');
  });

  it('returns null rather than dividing by zero or a missing figure', () => {
    expect(turnoverPhrase(0, 1_000)).toBeNull();
    expect(turnoverPhrase(1_000, 0)).toBeNull();
  });

  // "39% still to unlock" is a share of MAX supply; the dilution a holder feels
  // is that share over the FLOAT. The model kept reporting the first as if it
  // were the second.
  it('expresses the unlock as a share of float, not of max supply', () => {
    expect(dilutionPhrase(61, 100)).toBe('a full unlock would grow the float by 64%'); // not 39%
    expect(dilutionPhrase(67, 100)).toBe('a full unlock would grow the float by 49%'); // not "a third"
    expect(dilutionPhrase(53, 100)).toBe('a full unlock would grow the float by 89%'); // not "more than double"
  });

  it('returns null when nothing is locked or the supply data is unusable', () => {
    expect(dilutionPhrase(100, 100)).toBeNull();
    expect(dilutionPhrase(0, 100)).toBeNull();
  });

  it('puts both derived figures into the snapshot the prompt receives', () => {
    const out = summarizeMarket({
      symbol: 'CELO',
      priceUsd: 0.0761,
      change24hPct: 3.4,
      change7dPct: 0.8,
      change30dPct: 19.4,
      marketCapUsd: 46_100_000,
      marketCapRank: 478,
      volume24hUsd: 14_100_000,
      circulatingSupply: 610_000_000,
      maxSupply: 1_000_000_000,
      athChangePct: -99,
    });
    expect(out).toMatch(/Turnover: the whole cap changes hands about once every 3\.3 days/);
    expect(out).toMatch(/a full unlock would grow the float by 64%/);
  });
});
