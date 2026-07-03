'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { useChainId } from 'wagmi';
import { ArrowLeft, ArrowRight, GraduationCap, Flame, Newspaper, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { explorerBase } from '@/lib/chains';
import { getContracts } from '@/lib/contracts';

interface Stats {
  threads: number;
  uniqueWallets: number;
  volumeUsd: string;
  x402Count: number;
  agentSpendUsd: string;
  repeatUsers: number;
}

interface Thread {
  chain_id: number;
  onchain_thread_id: string;
  wallet_address: string;
  mode: number;
  token_symbol: string;
  pay_tx_hash: string;
  topic: string | null;
  total_cost_usd: string | null;
  status: string;
  created_at: string;
}

const fetcher = (u: string) => fetch(u).then((r) => r.json());

const RECENT_LIMIT = 5;

function chainLabel(chainId: number): string {
  if (chainId === 42220) return 'Celo mainnet';
  if (chainId === 11142220) return 'Celo Sepolia';
  return `chainId ${chainId}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function StatsPage() {
  const chainId = useChainId();
  const explorer = explorerBase(chainId);
  const { data: stats, error: statsError } = useSWR<Stats>(
    `/api/public/analytics?chainId=${chainId}`,
    fetcher,
    { refreshInterval: 30_000 },
  );
  const { data: threadsData } = useSWR<{ threads: Thread[] }>(
    `/api/public/threads?chainId=${chainId}&limit=${RECENT_LIMIT}`,
    fetcher,
    { refreshInterval: 30_000 },
  );
  const threads = threadsData?.threads ?? [];
  const couldHaveMore = threads.length >= RECENT_LIMIT;

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-6 pt-10">
      <header className="w-full max-w-md flex flex-col gap-3">
        <Link
          href="/"
          className="self-start flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors"
        >
          <ArrowLeft size={12} aria-hidden />
          Back to composer
        </Link>

        <div>
          <p className="heading-sub text-[10px]">
            Public Stats · {chainLabel(chainId)}
          </p>
          <h1 className="text-2xl font-bold font-mono tracking-tight mt-1">
            Stats
          </h1>
        </div>

        <p className="text-sm font-sans text-muted-foreground leading-snug">
          Pulled live from the chain. Refreshed every 30 seconds.
        </p>
      </header>

      <RuleDivider />

      <section className="w-full max-w-md flex flex-col gap-4">
        <p className="heading-sub text-[10px]">Metrics</p>

        {!stats && !statsError && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin text-muted-foreground" aria-hidden />
            Loading stats…
          </div>
        )}

        {statsError && (
          <p className="text-sm font-sans text-destructive">
            Failed to load stats. Try again later.
          </p>
        )}

        {stats && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Metric label="threads composed" value={stats.threads} />
              <Metric label="unique wallets" value={stats.uniqueWallets} />
              <Metric label="volume on chain" value={`$${stats.volumeUsd}`} money />
              <Metric label="x402 settlements" value={stats.x402Count} />
              <Metric label="agent x402 spend" value={`$${stats.agentSpendUsd}`} money />
              <Metric label="repeat wallets" value={stats.repeatUsers} />
            </div>
            <div className="flex flex-col gap-1">
              <a
                href={`${explorer}/address/${getContracts(chainId).AgentWallet}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors"
              >
                Audit the agent wallet on-chain
                <ArrowRight size={11} aria-hidden />
              </a>
              <a
                href={`${explorer}/address/${getContracts(chainId).ShipPostPayment}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors"
              >
                Inspect the payment contract on-chain
                <ArrowRight size={11} aria-hidden />
              </a>
            </div>
          </>
        )}
      </section>

      <RuleDivider />

      <section className="w-full max-w-md flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="heading-sub text-[10px]">Recent entries</p>
          {threads.length > 0 && (
            <span className="font-mono text-[11px] text-muted-foreground">
              last {threads.length}
            </span>
          )}
        </div>

        {!threadsData && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin text-muted-foreground" aria-hidden />
            Loading entries…
          </div>
        )}

        {threadsData && threads.length === 0 && (
          <p className="text-sm font-sans text-muted-foreground">
            No threads yet on this chain.
          </p>
        )}

        <ol className="flex flex-col gap-2 list-none">
          {threads.map((t) => (
            <ThreadEntry key={`${t.chain_id}-${t.onchain_thread_id}`} thread={t} explorer={explorer} />
          ))}
        </ol>

        {couldHaveMore && (
          <Link
            href="/history"
            className="self-end mt-1 flex items-center gap-1 font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors group"
          >
            See more
            <ArrowRight
              size={11}
              aria-hidden
              className="transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        )}
      </section>
    </main>
  );
}

function Metric({
  label,
  value,
  money,
}: {
  label: string;
  value: number | string;
  money?: boolean;
}) {
  return (
    <TerminalPanel title={label}>
      <span
        className={`text-2xl font-bold font-mono tabular-nums leading-none ${
          money ? 'text-money' : 'text-foreground'
        }`}
      >
        {value}
      </span>
    </TerminalPanel>
  );
}

function ThreadEntry({ thread, explorer }: { thread: Thread; explorer: string }) {
  const ModeIcon = thread.mode === 0 ? GraduationCap : thread.mode === 3 ? Newspaper : Flame;
  return (
    <li>
      <Card className="p-3 flex items-start gap-3">
        <ModeIcon size={14} className="text-muted-foreground shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <p className="text-sm line-clamp-1 leading-tight">
            {thread.topic ?? '(no topic)'}
          </p>
          <p className="text-[11px] text-muted-foreground font-mono">
            {thread.token_symbol} · {formatDate(thread.created_at)}
          </p>
        </div>
        <a
          href={`${explorer}/tx/${thread.pay_tx_hash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors shrink-0 self-center"
        >
          tx →
        </a>
      </Card>
    </li>
  );
}
