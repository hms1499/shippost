'use client';

import useSWR from 'swr';
import { Check, X, Loader2 } from 'lucide-react';

interface Thread {
  chain_id: number;
  onchain_thread_id: string;
  mode: number;
  token_symbol: string;
  pay_tx_hash: string;
  topic: string | null;
  total_cost_usd: string | null;
  tweets: string[] | null;
  status: string;
  created_at: string;
}

const fetcher = (u: string) => fetch(u).then((r) => r.json());

interface Props {
  walletAddress: string;
  chainId: number;
  explorerBase: string;
}

const MODE_LABEL: Record<number, string> = {
  0: 'EDU',
  1: 'HOT',
  2: 'TKN',
  3: 'REC',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistoryList({ walletAddress, chainId, explorerBase }: Props) {
  const { data, isLoading, error } = useSWR<{ threads: Thread[] }>(
    `/api/public/threads?wallet=${walletAddress.toLowerCase()}&chainId=${chainId}&limit=50`,
    fetcher,
  );

  if (isLoading)
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-2">
        <Loader2 size={12} className="animate-spin text-muted-foreground" aria-hidden />
        Loading history…
      </p>
    );

  if (error)
    return (
      <p className="text-sm text-destructive">
        Failed to load history. Refresh to try again.
      </p>
    );

  const threads = data?.threads ?? [];

  if (threads.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No threads yet — run your first one from the composer.
      </p>
    );

  return (
    <ol className="w-full max-w-md flex flex-col list-none font-mono">
      {threads.map((t, i) => (
        <HistoryEntry
          key={`${t.chain_id}-${t.onchain_thread_id}`}
          thread={t}
          explorerBase={explorerBase}
          index={i}
        />
      ))}

      <style jsx>{`
        @keyframes row-reveal {
          0% { opacity: 0; transform: translateY(6px); }
          100% { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ol>
  );
}

function HistoryEntry({
  thread,
  explorerBase,
  index,
}: {
  thread: Thread;
  explorerBase: string;
  index: number;
}) {
  const modeLabel = MODE_LABEL[thread.mode] ?? '???';

  const statusGlyph =
    thread.status === 'completed' ? (
      <Check size={11} className="inline text-primary" aria-label="completed" />
    ) : thread.status === 'failed' ? (
      <X size={11} className="inline text-destructive" aria-label="failed" />
    ) : (
      <Loader2 size={11} className="inline animate-spin text-money" aria-label="processing" />
    );

  return (
    <li
      className="border-b border-border"
      style={{ animation: `row-reveal 0.4s ${index * 0.04}s ease-out both` }}
    >
      <a
        href={`${explorerBase}/tx/${thread.pay_tx_hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex flex-col gap-0.5 py-2.5 text-xs no-underline hover:bg-primary/5 transition-colors"
      >
        <span className="flex items-center gap-3">
          <span className="text-muted-foreground shrink-0">
            #{thread.onchain_thread_id}
          </span>
          <span className="heading-sub text-[10px] shrink-0">{modeLabel}</span>
          <span className="flex-1 min-w-0 text-muted-foreground truncate">
            {formatDate(thread.created_at)}
          </span>
          <span className="text-money shrink-0">
            {thread.total_cost_usd ? `$${thread.total_cost_usd}` : '—'}
          </span>
          <span className="shrink-0">{statusGlyph}</span>
          <span className="shrink-0 text-muted-foreground/70" aria-hidden>
            ↗
          </span>
        </span>
        {thread.topic && (
          <span className="block min-w-0 truncate text-[11px] text-muted-foreground/70">
            └ {thread.topic}
          </span>
        )}
      </a>
    </li>
  );
}
