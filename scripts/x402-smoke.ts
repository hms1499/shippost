/**
 * x402 Base smoke test (Task 9 of docs/superpowers/plans/2026-06-02-real-x402-groq-base.md)
 *
 * Drives the real x402 settlement loop against the deployed proxy + facilitator,
 * WITHOUT any on-chain ShipPostPayment/AgentWallet contract (Task 9 Step 1 defers
 * Base contract deployment to the separate multi-chain spec). It calls
 * payGroqViaX402 directly: cap-check -> pay /api/x402/groq via EIP-3009 ->
 * facilitator verifies & settles only after Groq returns a valid thread.
 *
 * Prereqs (Base Sepolia):
 *   - Agent EOA (AGENT_WALLET_PRIVATE_KEY) funded with Base Sepolia ETH (gas)
 *     and test USDC (Circle faucet: https://faucet.circle.com).
 *   - The proxy reachable at X402_PROXY_BASE_URL/api/x402/groq (a deployed/preview
 *     URL, or `pnpm dev` for X402_PROXY_BASE_URL=http://localhost:3000).
 *   - Upstash env set (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN) — backs
 *     the daily-cap counter.
 *   - X402_CHAIN_ID=84532, X402_PAY_TO=<treasury you control>. Facilitator URL
 *     left unset uses the x402.org testnet facilitator.
 *
 * NOTE: this driver always exercises the x402 path regardless of X402_SETTLE_MODE
 * (it calls payGroqViaX402 directly). X402_SETTLE_MODE only gates the production
 * pipeline's choice between legacy and x402 — it is printed below for awareness.
 *
 * Run:
 *   pnpm dlx tsx scripts/x402-smoke.ts                 # Step 4: expect one payment
 *   pnpm dlx tsx scripts/x402-smoke.ts --expect=cap    # Step 5: set X402_DAILY_CAP_USDC below price first
 *   pnpm dlx tsx scripts/x402-smoke.ts --expect=pause  # Step 5: set X402_PAUSED=true first
 *   pnpm dlx tsx scripts/x402-smoke.ts --expect=fail   # Step 6: set an invalid GROQ_API_KEY on the proxy first
 *   pnpm dlx tsx scripts/x402-smoke.ts --topic "Write a 3-tweet thread about sBTC."
 *
 * Flags:
 *   --expect=<success|cap|pause|fail>  what outcome to assert (default: success)
 *   --topic "<text>"                   the user prompt to send  (default: stablecoins thread)
 *
 * Exit code is non-zero if the observed outcome does not match --expect, so this
 * is safe to chain in a verification gate.
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), '.env.local'), override: false });

import { payGroqViaX402 } from '../lib/x402/client';
import { getSettleMode, getX402ChainConfig } from '../lib/x402/config';

type Expect = 'success' | 'cap' | 'pause' | 'fail';

const EXPLORER: Record<number, string> = {
  8453: 'https://basescan.org',
  84532: 'https://sepolia.basescan.org',
};

function parseArgs(argv: string[]): { expect: Expect; topic: string } {
  let expect: Expect = 'success';
  let topic = 'Write a punchy 3-tweet thread explaining what stablecoins are.';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--expect=')) {
      const v = a.slice('--expect='.length) as Expect;
      if (!['success', 'cap', 'pause', 'fail'].includes(v)) {
        throw new Error(`--expect must be success|cap|pause|fail, got "${v}"`);
      }
      expect = v;
    } else if (a === '--topic') {
      topic = argv[++i] ?? topic;
    } else if (a.startsWith('--topic=')) {
      topic = a.slice('--topic='.length);
    }
  }
  return { expect, topic };
}

// Substrings we expect in the thrown error for each guard outcome. payGroqViaX402
// surfaces these verbatim (see lib/x402/cap.ts + client.ts), so a substring match
// confirms we failed for the RIGHT reason rather than some unrelated crash.
const ERROR_NEEDLE: Record<Exclude<Expect, 'success'>, string> = {
  cap: 'daily spend cap exceeded',
  pause: 'settlement paused',
  fail: 'x402 groq proxy failed',
};

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`✗ missing required env: ${name}`);
    process.exit(2);
  }
  return v;
}

async function main() {
  const { expect, topic } = parseArgs(process.argv.slice(2));

  // Preflight: validate env and echo the effective config (no secrets) so a
  // failed run is diagnosable from the log alone.
  requireEnv('AGENT_WALLET_PRIVATE_KEY');
  const proxyBase = requireEnv('X402_PROXY_BASE_URL');
  const chainId = Number(process.env.X402_CHAIN_ID || '84532');

  let cfg;
  try {
    cfg = getX402ChainConfig(chainId);
  } catch {
    console.error(`✗ X402_CHAIN_ID=${chainId} is not a supported Base chain (8453 / 84532)`);
    process.exit(2);
  }

  console.log('── x402 smoke test ──────────────────────────────');
  console.log(`expect          : ${expect}`);
  console.log(`chainId         : ${chainId}  (${cfg.caip2})`);
  console.log(`usdc            : ${cfg.usdc}`);
  console.log(`proxy           : ${proxyBase}/api/x402/groq`);
  console.log(`payTo           : ${process.env.X402_PAY_TO || '(unset!)'}`);
  console.log(`settle mode     : ${getSettleMode(chainId)}  (pipeline gate; driver always uses x402)`);
  console.log(`daily cap (USDC): ${process.env.X402_DAILY_CAP_USDC || '5 (default)'}`);
  console.log(`paused          : ${process.env.X402_PAUSED || 'false'}`);
  console.log('─────────────────────────────────────────────────');

  let result;
  try {
    result = await payGroqViaX402({
      chainId,
      messages: [{ role: 'user', content: topic }],
      temperature: 0.7,
      maxTokens: 1200,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (expect === 'success') {
      console.error(`✗ expected a successful payment but it threw: ${msg}`);
      process.exit(1);
    }
    const needle = ERROR_NEEDLE[expect];
    if (msg.includes(needle)) {
      console.log(`✓ guard fired as expected (${expect}): ${msg}`);
      console.log('  → verify on the explorer that NO USDC transfer occurred.');
      return;
    }
    console.error(`✗ expected "${needle}" (${expect}) but got a different error: ${msg}`);
    process.exit(1);
  }

  // Reached only on a successful payment.
  if (expect !== 'success') {
    console.error(`✗ expected the "${expect}" guard to fire, but the payment SUCCEEDED — funds may have moved.`);
    console.error(`  tweets=${result.tweets.length} settleTx=${result.settlementTxHash || '(none)'}`);
    process.exit(1);
  }

  const explorer = EXPLORER[chainId];
  console.log(`✓ payment settled — ${result.tweets.length} tweet(s) returned`);
  console.log(`  settlement tx : ${result.settlementTxHash || '(no hash in X-PAYMENT-RESPONSE)'}`);
  if (result.settlementTxHash && explorer) {
    console.log(`  explorer      : ${explorer}/tx/${result.settlementTxHash}`);
  }
  console.log('  → confirm a 0.001 USDC transfer from the agent EOA to X402_PAY_TO on the explorer.');
  console.log('\nfirst tweet preview:');
  console.log(`  ${result.tweets[0]?.slice(0, 200) ?? '(empty)'}`);
}

main().catch((e) => {
  console.error('✗ smoke test crashed:', e instanceof Error ? e.stack : e);
  process.exit(1);
});
