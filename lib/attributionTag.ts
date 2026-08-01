import { toDataSuffix, codeFromHostname } from '@celo/attribution-tags';
import type { Hex } from 'viem';

// ERC-8021 attribution suffix, appended to the calldata of every transaction
// this app sends on Celo. The EVM discards trailing calldata bytes, so the
// suffix is invisible to the contract being called — it never changes what a
// transaction does. It only makes the transaction identifiable as ours.
//
// Why it matters: Celo's reward programs (MiniPay's usage-based incentives,
// hackathon leaderboards, future ecosystem distributions) credit only tagged
// transactions, and tagging is NOT retroactive. Every untagged transaction is
// unattributable history that can never be claimed back.
//
// Two codes travel together in one suffix:
//   1. A hostname-derived code — deterministic and registration-free, so the
//      app can start tagging immediately instead of waiting on onboarding.
//   2. An assigned code (the `celo_...` issued at program registration). Some
//      leaderboards credit ONLY the assigned code, so it has to be present —
//      but it arrives later than (1), hence the env var rather than a constant.

// Derived from NEXT_PUBLIC_APP_URL rather than window.location, deliberately:
// server-side callers (the agent wallet, the refund worker) have no `window`,
// and a user reaching the app on a secondary domain would otherwise produce a
// second, different code — splitting our attribution across two buckets that
// no program would ever recombine. One configured origin = one code, on both
// sides of the wire.
function appHostname(): string | undefined {
  // A Vercel env var stored as "" (the CLI stdin bug, hit twice on this
  // project) is present-but-empty, so `??` would let a blank through. Same
  // blank-is-absent treatment as shareAppUrl.
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv).hostname || undefined;
    } catch {
      // Malformed URL — fall through to the browser hostname below.
    }
  }
  if (typeof window !== 'undefined') return window.location.hostname || undefined;
  return undefined;
}

function build(): Hex | null {
  const codes: string[] = [];

  const host = appHostname();
  if (host) {
    try {
      codes.push(codeFromHostname(host));
    } catch {
      // Unusable hostname — carry on with whatever else we have.
    }
  }

  const assigned = process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_CODE?.trim();
  // Dedupe: if the assigned code happens to match the derived one, emitting it
  // twice would double-count this app on the attribution dashboard.
  if (assigned && !codes.includes(assigned)) codes.push(assigned);

  if (codes.length === 0) return null;

  try {
    return toDataSuffix(codes) as Hex;
  } catch {
    // The SDK rejects codes outside [a-z0-9_]{1,32}. A typo'd env var must not
    // be able to stop anyone from paying — drop the tag, keep the payment.
    return null;
  }
}

// `undefined` = "no cached value yet"; `null` = "computed, and there is no
// usable tag" — so a miss is computed once, not on every transaction.
let cached: Hex | null | undefined;

/**
 * The ERC-8021 suffix to pass as `dataSuffix` on Celo transactions, or
 * `undefined` when no tag is configured.
 *
 * Never throws. Attribution is telemetry: if it cannot be built, the
 * transaction must still go out untagged rather than fail.
 */
export function getAttributionSuffix(): Hex | undefined {
  if (cached === undefined) cached = build();
  return cached ?? undefined;
}

/** Test-only: drop the memoized suffix so env changes take effect. */
export function resetAttributionSuffixCache(): void {
  cached = undefined;
}
