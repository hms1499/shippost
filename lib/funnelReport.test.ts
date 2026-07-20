import { describe, it, expect } from 'vitest';
import {
  computeFunnel,
  partitionByAudience,
  parseInternalWallets,
  type FunnelRow,
} from './funnelReport';

function row(session_id: string, stage: string, mode: number | null = null): FunnelRow {
  return { session_id, stage, mode };
}

describe('computeFunnel', () => {
  it('counts distinct sessions per stage (dedupes repeats)', () => {
    const r = computeFunnel([
      row('a', 'connect'),
      row('a', 'connect'), // duplicate same session+stage
      row('b', 'connect'),
      row('a', 'mode_select', 1),
    ]);
    expect(r.perStage.connect).toBe(2);
    expect(r.perStage.mode_select).toBe(1);
    expect(r.perStage.share).toBe(0);
  });

  it('computes stage→stage conversion as a fraction of the previous stage', () => {
    const r = computeFunnel([
      row('a', 'connect'), row('b', 'connect'), row('c', 'connect'), row('d', 'connect'),
      row('a', 'mode_select', 0), row('b', 'mode_select', 0),
      row('a', 'submit', 0),
    ]);
    // connect=4, mode_select=2 → 0.5 ; mode_select=2, submit=1 → 0.5
    expect(r.conversion.mode_select).toBeCloseTo(0.5);
    expect(r.conversion.submit).toBeCloseTo(0.5);
  });

  it('never divides by zero (0 upstream → 0 conversion, not NaN)', () => {
    const r = computeFunnel([row('a', 'pay', 1)]);
    expect(r.conversion.pay).toBe(0);
    expect(Number.isNaN(r.conversion.pay)).toBe(false);
  });

  it('breaks down sessions by mode from mode_select onward', () => {
    const r = computeFunnel([
      row('a', 'mode_select', 0), row('a', 'pay', 0),
      row('b', 'mode_select', 1), row('b', 'pay', 1), row('b', 'share', 1),
      row('c', 'mode_select', 1),
    ]);
    expect(r.byMode[0].mode_select).toBe(1);
    expect(r.byMode[0].pay).toBe(1);
    expect(r.byMode[1].mode_select).toBe(2);
    expect(r.byMode[1].pay).toBe(1);
    expect(r.byMode[1].share).toBe(1);
  });

  it('handles empty input', () => {
    const r = computeFunnel([]);
    expect(r.perStage.connect).toBe(0);
    expect(r.conversion.connect).toBe(0);
    expect(r.byMode[2].pay).toBe(0);
  });
});

describe('parseInternalWallets', () => {
  it('parses a comma-separated list, lowercased and trimmed', () => {
    const s = parseInternalWallets(' 0xAbC0000000000000000000000000000000000001 , 0xdef0000000000000000000000000000000000002 ');
    expect(s.has('0xabc0000000000000000000000000000000000001')).toBe(true);
    expect(s.has('0xdef0000000000000000000000000000000000002')).toBe(true);
    expect(s.size).toBe(2);
  });

  it('ignores empty/blank entries and undefined input', () => {
    expect(parseInternalWallets(undefined).size).toBe(0);
    expect(parseInternalWallets('').size).toBe(0);
    expect(parseInternalWallets(' , ,').size).toBe(0);
  });

  it('drops entries that are not wallet addresses', () => {
    const s = parseInternalWallets('not-a-wallet,0xabc0000000000000000000000000000000000001');
    expect(s.size).toBe(1);
    expect(s.has('0xabc0000000000000000000000000000000000001')).toBe(true);
  });
});

const DEV = '0xAbC0000000000000000000000000000000000001';
const USER = '0x1230000000000000000000000000000000000009';

function wrow(
  session_id: string,
  stage: string,
  mode: number | null = null,
  wallet_address: string | null = null,
): FunnelRow {
  return { session_id, stage, mode, wallet_address };
}

describe('partitionByAudience', () => {
  it('routes a session touched by an internal wallet entirely to internal', () => {
    const { organic, internal } = partitionByAudience(
      [
        wrow('a', 'connect', null, DEV),
        wrow('a', 'mode_select', 1, null), // same session, wallet not repeated
        wrow('b', 'connect', null, USER),
        wrow('b', 'mode_select', 1, null),
      ],
      parseInternalWallets(DEV),
    );
    // The null-wallet follow-up must travel with its session, not default to organic.
    expect(internal.map((r) => r.session_id)).toEqual(['a', 'a']);
    expect(organic.map((r) => r.session_id)).toEqual(['b', 'b']);
  });

  it('matches wallets case-insensitively (checksummed vs lowercase)', () => {
    const { internal } = partitionByAudience(
      [wrow('a', 'connect', null, DEV.toLowerCase())],
      parseInternalWallets(DEV.toUpperCase()),
    );
    expect(internal).toHaveLength(1);
  });

  it('treats sessions with no wallet at all as organic', () => {
    const { organic, internal } = partitionByAudience(
      [wrow('a', 'connect'), wrow('a', 'mode_select', 0)],
      parseInternalWallets(DEV),
    );
    expect(organic).toHaveLength(2);
    expect(internal).toHaveLength(0);
  });

  it('classifies everything as organic when the allowlist is empty', () => {
    const rows = [wrow('a', 'connect', null, DEV), wrow('b', 'connect', null, USER)];
    const { organic, internal } = partitionByAudience(rows, new Set<string>());
    expect(organic).toHaveLength(2);
    expect(internal).toHaveLength(0);
  });

  it('feeds computeFunnel so organic counts exclude internal sessions', () => {
    const rows = [
      wrow('dev', 'connect', null, DEV), wrow('dev', 'pay', 2, DEV),
      wrow('u1', 'connect', null, USER), wrow('u1', 'pay', 2, USER),
      wrow('u2', 'connect', null, USER),
    ];
    const { organic, internal } = partitionByAudience(rows, parseInternalWallets(DEV));
    expect(computeFunnel(organic).perStage.connect).toBe(2);
    expect(computeFunnel(organic).perStage.pay).toBe(1);
    expect(computeFunnel(internal).perStage.pay).toBe(1);
  });
});

describe('byMode mode 5 (News Breakdown)', () => {
  it('buckets mode-5 rows into byMode[5]', () => {
    const rows = [
      { session_id: 'a', stage: 'mode_select', mode: 5 },
      { session_id: 'b', stage: 'mode_select', mode: 1 },
    ];
    const r = computeFunnel(rows);
    expect(r.byMode[5].mode_select).toBe(1);
    expect(r.byMode[1].mode_select).toBe(1);
  });
});
