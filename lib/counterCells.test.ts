import { describe, it, expect } from 'vitest';
import { counterCells } from './counterCells';

const keys = (v: string) => counterCells(v).map((c) => c.key);

describe('counterCells', () => {
  it('splits digits from separators', () => {
    expect(counterCells('$1.30').map((c) => [c.char, c.isDigit])).toEqual([
      ['$', false], ['1', true], ['.', false], ['3', true], ['0', true],
    ]);
  });

  it('keeps keys stable when the figure has not changed', () => {
    expect(keys('1,048')).toEqual(keys('1,048'));
  });

  // The regression this file exists for: an index-only key let React reuse the
  // node, and digit-roll only plays on mount, so a live increment was silent.
  it('changes the key of a digit that changed, and only that digit', () => {
    const before = keys('13');
    const after = keys('14');
    expect(after[0]).toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it('changes keys from the first differing position when the width grows', () => {
    const before = keys('9');
    const after = keys('10');
    expect(after).toHaveLength(2);
    expect(after[0]).not.toBe(before[0]);
  });

  it('does not collide across positions showing the same character', () => {
    const k = keys('11');
    expect(new Set(k).size).toBe(k.length);
  });
});
