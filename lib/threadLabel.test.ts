import { describe, it, expect } from 'vitest';
import { threadLabel } from './threadLabel';

describe('threadLabel', () => {
  it('uses the topic when present', () => {
    expect(threadLabel({ mode: 0, topic: 'zk rollups' })).toBe('zk rollups');
    expect(threadLabel({ mode: 1, topic: 'BTC ETF inflows' })).toBe('BTC ETF inflows');
  });

  it('trims and ignores whitespace-only topics', () => {
    expect(threadLabel({ mode: 0, topic: '  spaced  ' })).toBe('spaced');
    expect(threadLabel({ mode: 0, topic: '   ' })).toBe('Untitled thread');
  });

  it('falls back to a per-mode label when the topic is null', () => {
    expect(threadLabel({ mode: 3, topic: null })).toBe('Daily Recap');
    expect(threadLabel({ mode: 1, topic: null })).toBe('Hot Take');
    expect(threadLabel({ mode: 2, topic: null })).toBe('Token Analysis');
    expect(threadLabel({ mode: 0, topic: null })).toBe('Untitled thread');
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
