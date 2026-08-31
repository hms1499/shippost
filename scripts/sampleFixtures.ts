/**
 * Sampling inputs, shared by every measurement harness in scripts/.
 *
 * Split out of thread-length-sample.ts when thread-read-sample.ts appeared:
 * two harnesses sampling DIFFERENT topics would report numbers that cannot be
 * compared, and the mistake would be invisible — both would look fine on their
 * own. One list, so a length run and a read run describe the same corpus.
 *
 * Local-only, like the rest of scripts/. Never imported by app or lib code.
 */
import type { PreviewInput } from '../lib/pipeline/modes';

export const MODE_LABEL: Record<number, string> = {
  0: 'Educational',
  1: 'Hot Take',
  2: 'Token Analysis',
  3: 'Daily Recap',
  4: 'Comparison',
  5: 'News Breakdown',
};

export const ALL_MODES = [0, 1, 2, 3, 4, 5];

/** Inputs per mode, cycled by run index so repeated runs vary the topic rather
 *  than re-rolling the same prompt. Educational leans on dense/advanced topics
 *  because that is where over-long tweets were seen to concentrate — and, since
 *  2026-08-31, where invented addresses and gas figures were seen too. */
export const FIXTURES: Record<number, PreviewInput[]> = {
  0: [
    { mode: 0, topic: 'EIP-4844 blob fee market', audience: 'advanced' },
    { mode: 0, topic: 'ERC-4337 bundler economics', audience: 'advanced' },
    { mode: 0, topic: 'how an optimistic rollup fraud proof works', audience: 'intermediate' },
    { mode: 0, topic: 'what a stablecoin depeg actually is', audience: 'beginner' },
  ],
  1: [
    { mode: 1, eventDescription: 'Base sequencer revenue fell sharply after Dencun', angle: 'skeptical' },
    { mode: 1, eventDescription: 'A major L2 announced it is decentralising its sequencer', angle: 'bullish' },
    { mode: 1, eventDescription: 'Another bridge exploit drained nine figures', angle: 'bearish' },
  ],
  2: [
    { mode: 2, topic: 'CELO', angle: 'skeptical' },
    { mode: 2, topic: 'ARB', angle: 'bearish' },
    { mode: 2, topic: 'OP', angle: 'bullish' },
  ],
  3: [{ mode: 3 }],
  4: [
    { mode: 4, topic: 'base|arbitrum' },
    { mode: 4, topic: 'solana|ethereum' },
    { mode: 4, topic: 'celo|polygon' },
  ],
  5: [
    { mode: 5, eventDescription: 'Circle expanded native USDC to another L2' },
    { mode: 5, eventDescription: 'The SEC closed an enforcement action against a DeFi protocol' },
  ],
};

export function numArg(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  const n = Number(arg.slice(name.length + 3));
  if (!Number.isFinite(n) || n < 1) throw new Error(`bad --${name}: ${arg}`);
  return n;
}

export function modesArg(): number[] {
  const arg = process.argv.find((a) => a.startsWith('--modes='));
  if (!arg) return ALL_MODES;
  return arg
    .slice('--modes='.length)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n));
}
