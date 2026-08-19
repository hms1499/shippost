'use client';

import useSWR from 'swr';
import { ArrowUpRight } from 'lucide-react';
import { DEFAULT_CHAIN_ID, chainLabel } from '@/lib/chainPolicy';
import { explorerBase } from '@/lib/chains';
import { CONTRACTS } from '@/lib/contracts';

interface Stats {
  threads: number;
  volumeUsd: string;
  x402Count: number;
}

const fetcher = (u: string) => fetch(u).then((r) => r.json() as Promise<Stats>);

// Explicit locale: the value is rendered client-side only, but a fixed
// formatter keeps the digits identical on every device.
const count = new Intl.NumberFormat('en-US');

/**
 * Pre-connect proof of work: the three numbers that say this thing is real —
 * threads composed, USD settled on chain, x402 calls the agent has paid for.
 *
 * Deliberately silent when there is nothing to show. A visitor who has never
 * seen CoinOp reads "0 threads · $0.00" as a dead product, so a zero count or
 * a failed fetch renders nothing at all rather than an empty scoreboard. The
 * loading state keeps the row's height so the form below it does not jump.
 */
export function PublicStatsStrip() {
  const chainId = DEFAULT_CHAIN_ID;
  const { data, error } = useSWR<Stats>(
    `/api/public/analytics?chainId=${chainId}`,
    fetcher,
    { refreshInterval: 30_000 },
  );

  // Stale data outlives a failed refresh: only the absence of numbers hides
  // the strip, never a refresh that happened to fail.
  const loading = !data && !error;
  if (!loading && (!data || data.threads === 0)) return null;

  const { ShipPostPayment, AgentWallet } = CONTRACTS[chainId] ?? {};
  const explorer = explorerBase(chainId);

  return (
    <section
      aria-label="Live public stats"
      className="w-full max-w-md self-center flex flex-col gap-3 border-y border-border py-4"
    >
      <dl className="grid grid-cols-3 gap-3 text-center">
        <Stat label="threads" value={data ? count.format(data.threads) : '—'} />
        <Stat label="on-chain volume" value={data ? `$${data.volumeUsd}` : '—'} money />
        <Stat label="x402 settlements" value={data ? count.format(data.x402Count) : '—'} />
      </dl>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="font-mono text-[11px] text-muted-foreground">
          live · {chainLabel(chainId)}
        </p>
        {/* The audit links are the point: anyone can check the numbers against
            the chain rather than take them from us. Rendered only when the
            addresses are configured — Base reads them from env. */}
        <div className="flex items-center gap-3">
          {AgentWallet && (
            <AuditLink href={`${explorer}/address/${AgentWallet}`}>agent wallet</AuditLink>
          )}
          {ShipPostPayment && (
            <AuditLink href={`${explorer}/address/${ShipPostPayment}`}>contract</AuditLink>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, money }: { label: string; value: string; money?: boolean }) {
  return (
    // Reversed in flow, not in the DOM: the label stays the term that precedes
    // its value for assistive tech, while the number reads first visually.
    <div className="flex flex-col-reverse items-center gap-1">
      <dt className="heading-sub text-[10px] leading-tight">{label}</dt>
      <dd
        className={`text-xl font-bold font-mono tabular-nums leading-none ${
          money ? 'text-money' : 'text-foreground'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function AuditLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors"
    >
      {children}
      <ArrowUpRight size={11} aria-hidden />
    </a>
  );
}
