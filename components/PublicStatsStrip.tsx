'use client';

import useSWR from 'swr';
import { ArrowUpRight } from 'lucide-react';
import { SUPPORTED_CHAIN_IDS, chainLabel } from '@/lib/chainPolicy';
import { explorerBase } from '@/lib/chains';
import { CONTRACTS } from '@/lib/contracts';
import { sumChainStats, type ChainStats } from '@/lib/publicStats';
import { OperatorCounter } from '@/components/OperatorCounter';

// One request per chain, folded into a single total. A chain that fails
// resolves to null and simply drops out of the sum.
async function fetchAllChains(): Promise<ChainStats> {
  const perChain = await Promise.all(
    SUPPORTED_CHAIN_IDS.map(async (id) => {
      try {
        const res = await fetch(`/api/public/analytics?chainId=${id}`);
        if (!res.ok) return null;
        return (await res.json()) as ChainStats;
      } catch {
        return null;
      }
    }),
  );
  // Every chain failed. Returning a zero total here would be a *successful*
  // answer of "this machine has done nothing" — indistinguishable from a brand
  // new deployment — and SWR would write it over the numbers already on
  // screen, so one dropped request emptied the counter. Throwing keeps the
  // last good data and marks the refresh failed, which is what happened.
  if (perChain.every((c) => c === null)) throw new Error('public stats unavailable');
  return sumChainStats(perChain);
}

// Explicit locale: the value is rendered client-side only, but a fixed
// formatter keeps the digits identical on every device.
const count = new Intl.NumberFormat('en-US');

/**
 * Pre-connect proof of work, drawn as the machine's own counter: threads
 * composed, USD settled on chain, x402 calls the agent has paid for.
 * Summed across every supported chain, because the work is split across them
 * and any one chain's row reads as a fraction of what CoinOp has actually done.
 *
 * Spans whatever width the landing gives it — a column on mobile, the full
 * folio on desktop — so its rules line up with the header rule above and the
 * two-column grid below instead of floating at half width.
 *
 * Deliberately silent when there is nothing to show. A visitor who has never
 * seen CoinOp reads "0 threads · $0.00" as a dead product, so a zero count or
 * a failed fetch renders nothing at all rather than an empty scoreboard. The
 * loading state keeps the row's height so the form below it does not jump.
 */
export function PublicStatsStrip() {
  const { data, error } = useSWR<ChainStats>('public-stats', fetchAllChains, {
    refreshInterval: 30_000,
  });

  // Stale data outlives a failed refresh: only the absence of numbers hides
  // the strip, never a refresh that happened to fail.
  const loading = !data && !error;
  if (!loading && (!data || data.threads === 0)) return null;

  const auditable = SUPPORTED_CHAIN_IDS.filter((id) => CONTRACTS[id]?.ShipPostPayment);

  return (
    <section
      aria-label="Live public stats"
      className="w-full flex flex-col gap-3 border-y border-border py-4 md:py-5"
    >
      <div className="grid grid-cols-3 gap-3 md:gap-6">
        <OperatorCounter label="threads" value={data ? count.format(data.threads) : '—'} />
        <OperatorCounter
          label="settled on chain"
          value={data ? `$${data.volumeUsd}` : '—'}
          money
        />
        <OperatorCounter label="x402 calls" value={data ? count.format(data.x402Count) : '—'} />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-mono text-[11px] text-muted-foreground">
          live · {SUPPORTED_CHAIN_IDS.map(chainLabel).join(' + ')}
        </p>
        {/* The audit links are the point: anyone can check the numbers against
            the chain rather than take them from us. One per chain, pointing at
            the payment contract — every thread's payment and every split out to
            the agent wallet passes through it. Chains with no configured
            address (Base reads its own from env) drop out. */}
        {auditable.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] text-muted-foreground">audit</span>
            {auditable.map((id) => (
              <AuditLink
                key={id}
                href={`${explorerBase(id)}/address/${CONTRACTS[id].ShipPostPayment}`}
              >
                {chainLabel(id)}
              </AuditLink>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function AuditLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      // 41x18 before. The audit links are the whole trust argument of this
      // strip, so they must be reachable by thumb, not just by cursor.
      className="inline-flex items-center gap-1 min-h-9 px-1 -mx-1 rounded font-mono text-[11px] text-muted-foreground no-underline hover:text-primary active:bg-primary/10 transition-colors"
    >
      {children}
      <ArrowUpRight size={11} aria-hidden />
    </a>
  );
}
