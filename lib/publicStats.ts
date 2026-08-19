/** One chain's slice of the public scoreboard, as `/api/public/analytics` returns it. */
export interface ChainStats {
  threads: number;
  volumeUsd: string;
  x402Count: number;
}

/**
 * Fold per-chain analytics into one scoreboard.
 *
 * CoinOp's history is split across the chains it runs on, so a single chain's
 * numbers understate the work by design — reading one chain's row as "how much
 * has this thing done" is the mistake this function exists to prevent.
 *
 * A chain whose request failed arrives as `null` and contributes nothing. That
 * makes a partial outage understate the total rather than overstate it, which
 * is the only safe direction for a number we ask strangers to trust.
 */
export function sumChainStats(perChain: readonly (ChainStats | null | undefined)[]): ChainStats {
  let threads = 0;
  let x402Count = 0;
  let volume = 0;

  for (const c of perChain) {
    if (!c) continue;
    threads += finite(c.threads);
    x402Count += finite(c.x402Count);
    // The endpoint sends volume as a fixed-decimal string; a malformed one
    // must not turn the whole total into NaN.
    volume += finite(Number(c.volumeUsd));
  }

  return { threads, x402Count, volumeUsd: volume.toFixed(2) };
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}
