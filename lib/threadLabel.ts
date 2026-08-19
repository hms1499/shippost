import { CHAINS } from '@/lib/prompts/comparison';

// Human-readable title for a thread row in public lists. Some modes carry no
// free-text "topic" (Daily Recap is input-free; Hot Take/Token rows can land
// with a null topic), so a bare `thread.topic` renders as an empty/"(no topic)"
// row that reads as broken data. Prefer the topic when present; otherwise fall
// back to the mode's name.
const MODE_FALLBACK: Record<number, string> = {
  0: 'Educational Thread',
  1: 'Hot Take',
  2: 'Token Analysis',
  3: 'Daily Recap',
  4: 'Chain Comparison',
  5: 'News Breakdown',
};

// Three-letter badge for dense mono rows (thread history). Keep this the single
// home for mode display strings: a new mode that lands here and in
// MODE_FALLBACK can't render as broken data in one list and fine in another.
// Ids are the on-chain ones emitted by ThreadRequested — see lib/pipeline/modes.
const MODE_CODE: Record<number, string> = {
  0: 'EDU',
  1: 'HOT',
  2: 'TKN',
  3: 'REC',
  4: 'CMP',
  5: 'NWS',
};

// Display names in mode order. Exported so anything listing what this machine
// can write reads the same strings as the history rows, per the note above.
export const MODE_NAMES: string[] = Object.keys(MODE_FALLBACK)
  .map(Number)
  .sort((a, b) => a - b)
  .map((id) => MODE_FALLBACK[id]);

export function modeCode(mode: number): string {
  return MODE_CODE[mode] ?? '???';
}

const CHAIN_LABEL: Record<string, string> = Object.fromEntries(
  CHAINS.map((c) => [c.key, c.label]),
);

// Mode 4 (Chain Comparison) encodes its two chains in `topic` as
// "<aKey>|<bKey>" (see lib/prompts/comparison.ts). Decode both keys to their
// display labels; an unrecognized key falls back to the raw key rather than
// hiding the row.
function comparisonLabel(topic: string): string {
  const [aKey, bKey] = topic.split('|').map((s) => s.trim().toLowerCase());
  const aLabel = CHAIN_LABEL[aKey] ?? aKey;
  const bLabel = CHAIN_LABEL[bKey] ?? bKey;
  return `${aLabel} vs ${bLabel}`;
}

export function threadLabel({ mode, topic }: { mode: number; topic: string | null }): string {
  const trimmed = topic?.trim();
  if (mode === 4 && trimmed) return comparisonLabel(trimmed);
  if (trimmed) return trimmed;
  return MODE_FALLBACK[mode] ?? 'Untitled thread';
}
