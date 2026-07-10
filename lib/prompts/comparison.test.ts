import { describe, it, expect } from 'vitest';
import { CHAINS, parseChains, serperQueryFor, buildComparisonPrompt } from './comparison';

describe('CHAINS whitelist', () => {
  it('has unique keys and non-empty DefiLlama names', () => {
    const keys = CHAINS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of CHAINS) {
      expect(c.key).toMatch(/^[a-z0-9-]+$/);
      expect(c.defiLlamaName.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
    }
  });
});

describe('parseChains', () => {
  it('returns the two entries for a valid distinct pair', () => {
    const out = parseChains('solana|base');
    expect(out?.[0].key).toBe('solana');
    expect(out?.[1].key).toBe('base');
  });

  it('rejects equal chains', () => {
    expect(parseChains('base|base')).toBeNull();
  });

  it('rejects an unknown chain', () => {
    expect(parseChains('solana|notachain')).toBeNull();
  });

  it('rejects missing / malformed input', () => {
    expect(parseChains(undefined)).toBeNull();
    expect(parseChains('solana')).toBeNull();
    expect(parseChains('')).toBeNull();
  });
});

describe('serperQueryFor', () => {
  it('names both chains', () => {
    const q = serperQueryFor('Solana', 'Base');
    expect(q).toContain('Solana');
    expect(q).toContain('Base');
  });
});

describe('buildComparisonPrompt', () => {
  it('names both chains and demands a single winner', () => {
    const p = buildComparisonPrompt({
      aLabel: 'Solana',
      bLabel: 'Base',
      chainData: 'Solana: TVL $9.10B (+4.2% 7d)\nBase: TVL $3.40B (-1.5% 7d)',
      searchSummary: null,
    });
    expect(p).toContain('Solana');
    expect(p).toContain('Base');
    expect(p.toLowerCase()).toContain('winner');
  });

  it('warns against inventing numbers when chain data is present', () => {
    const p = buildComparisonPrompt({ aLabel: 'Celo', bLabel: 'Base', chainData: 'Celo: TVL $120.0M', searchSummary: null });
    expect(p.toLowerCase()).toContain('do not invent');
  });

  it('handles absent grounding without throwing', () => {
    const p = buildComparisonPrompt({ aLabel: 'Sui', bLabel: 'Aptos', chainData: null, searchSummary: null });
    expect(p).toContain('Sui');
    expect(p).toContain('Aptos');
  });
});
