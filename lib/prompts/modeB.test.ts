import { describe, it, expect } from 'vitest';
import { buildModeBPrompt } from './modeB';

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
