import { describe, it, expect } from 'vitest';
import { threadLabel, modeCode } from './threadLabel';

describe('threadLabel', () => {
  it('uses the topic when present', () => {
    expect(threadLabel({ mode: 0, topic: 'zk rollups' })).toBe('zk rollups');
    expect(threadLabel({ mode: 1, topic: 'BTC ETF inflows' })).toBe('BTC ETF inflows');
  });

  it('trims and ignores whitespace-only topics', () => {
    expect(threadLabel({ mode: 0, topic: '  spaced  ' })).toBe('spaced');
    // Whitespace-only is the same as absent, so this takes the mode fallback.
    expect(threadLabel({ mode: 0, topic: '   ' })).toBe('Educational Thread');
  });

  it('falls back to a per-mode label when the topic is null', () => {
    expect(threadLabel({ mode: 3, topic: null })).toBe('Daily Recap');
    expect(threadLabel({ mode: 1, topic: null })).toBe('Hot Take');
    expect(threadLabel({ mode: 2, topic: null })).toBe('Token Analysis');
    // Mode 0 used to land on 'Untitled thread' — a real mode rendered as if it
    // did not exist. Latent while every Educational row carried a topic; the
    // resume screen, which has no topic to pass, surfaced it.
    expect(threadLabel({ mode: 0, topic: null })).toBe('Educational Thread');
  });

  it('falls back to "Untitled thread" for an unknown mode with no topic', () => {
    expect(threadLabel({ mode: 9, topic: null })).toBe('Untitled thread');
  });

  it('decodes mode-4 comparison topics to "<LabelA> vs <LabelB>"', () => {
    expect(threadLabel({ mode: 4, topic: 'solana|base' })).toBe('Solana vs Base');
    expect(threadLabel({ mode: 4, topic: 'ethereum|bsc' })).toBe('Ethereum vs BNB Chain');
  });

  it('falls back to the raw key for an unrecognized mode-4 chain key', () => {
    expect(threadLabel({ mode: 4, topic: 'solana|madeupchain' })).toBe('Solana vs madeupchain');
  });

  it('falls back to "Chain Comparison" for mode 4 with no topic', () => {
    expect(threadLabel({ mode: 4, topic: null })).toBe('Chain Comparison');
  });

  it('falls back to "News Breakdown" for a topicless mode-5 row', () => {
    expect(threadLabel({ mode: 5, topic: null })).toBe('News Breakdown');
  });

  it('prefers the headline topic for a mode-5 row', () => {
    expect(threadLabel({ mode: 5, topic: 'SEC approves spot ETH ETFs' })).toBe(
      'SEC approves spot ETH ETFs',
    );
  });
});

describe('modeCode', () => {
  it('covers every shipped mode id', () => {
    expect(modeCode(0)).toBe('EDU');
    expect(modeCode(1)).toBe('HOT');
    expect(modeCode(2)).toBe('TKN');
    expect(modeCode(3)).toBe('REC');
    expect(modeCode(4)).toBe('CMP');
    expect(modeCode(5)).toBe('NWS');
  });

  it('never renders a shipped mode as unknown data', () => {
    // Regression: history showed '???' for comparison (4) and news-breakdown (5)
    // because the badge map stopped at 3.
    for (const mode of [0, 1, 2, 3, 4, 5]) {
      expect(modeCode(mode)).not.toBe('???');
    }
  });

  it('falls back for an id this build does not know', () => {
    expect(modeCode(9)).toBe('???');
  });
});
