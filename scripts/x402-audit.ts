/**
 * x402 audit — classify recent completed threads as Model 2 (x402, USDC on
 * Base) vs legacy (cUSD on Celo), reading the persisted groq_settle_chain_id.
 *
 * Positive proof that a real paid thread routed its Groq settle through the
 * real x402 rail on Base — the endpoint smoke test cannot show this because it
 * bypasses the pipeline's getSettleMode() decision.
 *
 * Prereqs: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE in env (point at prod to
 * audit prod). Migration 0008 must be applied first.
 *
 * Run:
 *   pnpm audit:x402                 # last 20 completed threads
 *   pnpm audit:x402 --limit=50
 *
 * Exit code is non-zero if the most recent completed thread is not x402, so
 * this is safe to chain in a verification gate.
 */
import 'dotenv/config';
import { getSupabaseServer } from '../lib/supabase';

const BASE_CHAINS = new Set([8453, 84532]);
const CELO_CHAINS = new Set([42220, 11142220]);

const EXPLORER: Record<number, string> = {
  8453: 'https://basescan.org',
  84532: 'https://sepolia.basescan.org',
};

type Verdict = 'x402' | 'legacy' | 'unknown';

function classify(chainId: number | null): Verdict {
  if (chainId != null && BASE_CHAINS.has(chainId)) return 'x402';
  if (chainId != null && CELO_CHAINS.has(chainId)) return 'legacy';
  return 'unknown';
}

function label(v: Verdict): string {
  if (v === 'x402') return 'x402 ✅ (Base)';
  if (v === 'legacy') return 'legacy (Celo)';
  return 'pre-audit (unknown)';
}

function parseLimit(argv: string[]): number {
  for (const a of argv) {
    if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) return Math.floor(n);
    }
  }
  return 20;
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const supabase = getSupabaseServer();
  const { data, error } = await supabase
    .from('threads')
    .select('created_at, mode, onchain_thread_id, groq_tx_hash, groq_settle_chain_id')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(error.message);
    process.exit(2);
  }
  if (!data || data.length === 0) {
    console.log('No completed threads found.');
    process.exit(1);
  }

  console.log(`Last ${data.length} completed thread(s):\n`);
  let x402Count = 0;
  for (const t of data) {
    const chainId = (t.groq_settle_chain_id as number | null) ?? null;
    const verdict = classify(chainId);
    if (verdict === 'x402') x402Count++;
    const explorer = chainId != null ? EXPLORER[chainId] : undefined;
    const txLink = explorer && t.groq_tx_hash ? `${explorer}/tx/${t.groq_tx_hash}` : (t.groq_tx_hash ?? '(none)');
    console.log(`${String(t.created_at).slice(0, 19)}  mode=${t.mode}  thread=${t.onchain_thread_id}`);
    console.log(`    ${label(verdict).padEnd(20)}  groq: ${txLink}`);
  }

  const newest = classify(((data[0].groq_settle_chain_id as number | null) ?? null));
  console.log(`\n${x402Count}/${data.length} recent completed threads settled Groq via x402 on Base.`);
  console.log(`Most recent completed thread: ${label(newest)}`);
  process.exit(newest === 'x402' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
