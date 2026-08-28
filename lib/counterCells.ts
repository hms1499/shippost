/**
 * Split a counter's rendered figure into the cells OperatorCounter draws.
 *
 * The only interesting part is the key. It used to be the array index, which
 * meant that when the live figure changed — the strip polls every 30s — React
 * kept the same DOM node and swapped its text. The `digit-roll` animation only
 * plays when an element mounts, so it never fired on an actual increment: the
 * counter rolled once on page load, when it was proving nothing, and sat silent
 * for the one event worth showing. Keying on the character remounts exactly the
 * digits that changed, which is also how a mechanical counter behaves.
 */
export interface CounterCell {
  char: string;
  isDigit: boolean;
  /** Stable while this position shows this character; changes when it does. */
  key: string;
}

export function counterCells(value: string): CounterCell[] {
  return [...value].map((char, i) => ({
    char,
    isDigit: /\d/.test(char),
    key: `${i}:${char}`,
  }));
}
