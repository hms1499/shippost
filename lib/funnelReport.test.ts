import { describe, it, expect } from 'vitest';
import { computeFunnel, type FunnelRow } from './funnelReport';

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
