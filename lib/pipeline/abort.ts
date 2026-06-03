// Throw before any x402 settle if the run's deadline already fired. Spending
// from AgentWallet for a thread the route has already declared `fatal`
// (refundable) would mean paying x402 AND refunding the user for one run — a
// real loss. Every settle site MUST gate on this.
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new Error('aborted: generation deadline exceeded');
}
