'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { useChainId } from 'wagmi';
import { ArrowLeft, ArrowRight, GraduationCap, Flame, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { InkText } from '@/components/InkText';
import { InkDivider } from '@/components/InkDivider';
import { FolioMark } from '@/components/FolioMark';
import { explorerBase } from '@/lib/chains';

interface Stats {
  threads: number;
  uniqueWallets: number;
  volumeUsd: string;
  x402Count: number;
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
        <div className="flex items-start justify-between">
          <Link
            href="/"
            className="self-start flex items-center gap-1.5 heading-sub text-[10px] no-underline hover:text-primary transition-colors"
          >
            <ArrowLeft size={12} aria-hidden />
            Back to composer
          </Link>
          <FolioMark numeral="II" />
        </div>

        <div>
          <p className="heading-sub text-[10px]">
            Public Stats · {chainLabel(chainId)}
          </p>
          <InkText
            as="h1"
            className="font-display italic text-[2.6rem] leading-[0.95] mt-1"
            delay={50}
          >
            Folio of records
          </InkText>
        </div>

        <p className="text-sm italic text-muted-foreground leading-snug">
          Pulled live from the chain. Refreshed every 30 seconds.
        </p>
      </header>

      <InkDivider />

      <section
        className="w-full max-w-md flex flex-col gap-4 reveal"
        style={{ animationDelay: '0.4s' }}
      >
        <p className="heading-sub text-[10px]">Index of metrics</p>

        {!stats && !statsError && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2
              size={12}
              className="animate-spin text-[hsl(var(--ink-faded))]"
              aria-hidden
            />
            Reckoning the books…
          </div>
        )}

        {statsError && (
          <p className="text-sm italic text-destructive">
            The records are illegible. Try again later.
          </p>
        )}

        {stats && (
          <Card ornament className="relative p-5">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              {/* Vertical ledger rule — separates the 2-col area; stops above
                  the bottom row which spans full width. */}
              <span
                aria-hidden
                className="pointer-events-none absolute top-5 bottom-[4.25rem] left-1/2 w-px bg-[hsl(var(--ink-faded)/0.3)]"
              />
              <Metric label="threads composed" value={stats.threads} />
              <Metric label="unique scribes" value={stats.uniqueWallets} />
              <Metric label="volume on chain" value={`$${stats.volumeUsd}`} />
              <Metric label="x402 settlements" value={stats.x402Count} />
              <div className="col-span-2 pt-3 border-t border-[hsl(var(--ink-faded)/0.3)]">
                <Metric label="repeat scribes" value={stats.repeatUsers} />
              </div>
            </div>
          </Card>
        )}
      </section>

      <InkDivider />

      <section
        className="w-full max-w-md flex flex-col gap-3 reveal"
        style={{ animationDelay: '0.7s' }}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="heading-sub text-[10px]">Recent entries</p>
          {threads.length > 0 && (
            <span className="heading-sub text-[10px]">
              last {threads.length}
            </span>
          )}
        </div>

        {!threadsData && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2
              size={12}
              className="animate-spin text-[hsl(var(--ink-faded))]"
              aria-hidden
            />
            Loading entries…
          </div>
        )}

        {threadsData && threads.length === 0 && (
          <p className="text-sm italic text-muted-foreground">
            No threads yet on this chain.
          </p>
        )}

        <ol className="flex flex-col gap-2 list-none">
          {threads.map((t, i) => (
            <ThreadEntry
              key={`${t.chain_id}-${t.onchain_thread_id}`}
              thread={t}
              explorer={explorer}
              index={i}
            />
          ))}
        </ol>

        {couldHaveMore && (
          <Link
            href="/history"
            className="self-end mt-1 flex items-center gap-1 heading-sub text-[10px] no-underline hover:text-primary transition-colors group"
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

      <style jsx>{`
        @keyframes reveal-up {
          0% { opacity: 0; transform: translateY(12px); filter: blur(2px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
        }
        .reveal {
          opacity: 0;
          animation: reveal-up 0.6s cubic-bezier(.2,.6,.2,1) forwards;
        }
      `}</style>
    </main>
  );
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-display italic text-[2rem] text-foreground tabular-nums leading-none">
        {value}
      </span>
      <span className="heading-sub text-[10px]">{label}</span>
    </div>
  );
}

function ThreadEntry({
  thread,
  explorer,
  index,
}: {
  thread: Thread;
  explorer: string;
  index: number;
}) {
  const ModeIcon = thread.mode === 0 ? GraduationCap : Flame;
  return (
    <li
      style={{
        animation: `reveal-up 0.5s ${0.7 + index * 0.05}s cubic-bezier(.2,.6,.2,1) both`,
      }}
    >
      <Card className="p-3 flex items-start gap-3">
        <ModeIcon
          size={14}
          className="text-[hsl(var(--ink-faded))] shrink-0 mt-0.5"
          aria-hidden
        />
        <div className="flex-1 min-w-0 flex flex-col gap-0.5">
          <p className="text-sm italic line-clamp-1 leading-tight">
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
          className="heading-sub text-[10px] no-underline hover:text-primary transition-colors shrink-0 self-center"
        >
          tx →
        </a>
      </Card>
    </li>
  );
}
