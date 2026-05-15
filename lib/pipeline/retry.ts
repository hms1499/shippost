// Retry a transient operation exactly once after a short delay.
//
// Scope it to the external-call portion of a step ONLY (fetch / LLM call),
// never around an x402 settle: a settle that times out may have broadcast,
// so retrying it risks a double-spend. The data fetch, by contrast, has no
// side effect, so a single retry cleanly absorbs the common transient
// failures (rate limits, 429s, brief timeouts) instead of degrading output.
export async function retryOnce<T>(
  fn: () => Promise<T>,
  opts: { delayMs?: number } = {},
): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, opts.delayMs ?? 500));
    return await fn();
  }
}
