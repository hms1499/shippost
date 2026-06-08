'use client';

import useSWR from 'swr';
import { GraduationCap, Flame, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/card';

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
        <Loader2
          size={12}
          className="animate-spin text-[hsl(var(--ink-faded))]"
          aria-hidden
        />
        Loading folios…
      </p>
    );

  if (error)
    return (
      <p className="text-sm text-destructive">
        The records are illegible. Refresh to try again.
      </p>
    );

  const threads = data?.threads ?? [];

  if (threads.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        No threads yet — your folio is blank parchment.
      </p>
    );

  return (
    <ol className="w-full max-w-md flex flex-col gap-2 list-none">
      {threads.map((t, i) => (
        <HistoryEntry
          key={`${t.chain_id}-${t.onchain_thread_id}`}
          thread={t}
          explorerBase={explorerBase}
          index={i}
        />
      ))}

      <style jsx>{`
        @keyframes folio-reveal {
          0% { opacity: 0; transform: translateY(10px); filter: blur(2px); }
          100% { opacity: 1; transform: translateY(0); filter: blur(0); }
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
  const isEducational = thread.mode === 0;
  const ModeIcon = isEducational ? GraduationCap : Flame;
  const modeLabel = isEducational ? 'Educational' : 'Hot Take';
  const completed = thread.status === 'completed';

  return (
    <li
      style={{
        animation: `folio-reveal 0.5s ${index * 0.06}s cubic-bezier(.2,.6,.2,1) both`,
      }}
    >
      <Card className="p-4 flex flex-col gap-2 transition-colors hover:border-[hsl(var(--ink-deep))]">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <ModeIcon
              size={14}
              className="text-[hsl(var(--ink-faded))] shrink-0"
              aria-hidden
            />
            <span className="heading-sub text-[10px]">{modeLabel}</span>
            {!completed && (
              <span className="heading-sub text-[10px] text-destructive">
                · {thread.status}
              </span>
            )}
          </div>
          <span className="font-mono text-[11px] text-[hsl(var(--ink-faded))] shrink-0">
            {formatDate(thread.created_at)}
          </span>
        </div>

        <p className="font-display italic text-base leading-snug line-clamp-2">
          {thread.topic ?? '(no topic)'}
        </p>

        <div className="flex items-baseline gap-2 mt-1 text-[11px]">
          <span className="text-muted-foreground">
            Paid 0.05 {thread.token_symbol}
          </span>
          {thread.total_cost_usd && (
            <>
              <span aria-hidden className="text-[hsl(var(--ink-faded))]">·</span>
              <span className="text-muted-foreground">
                agent spent ${thread.total_cost_usd}
              </span>
            </>
          )}
          <span
            aria-hidden
            className="flex-1 border-b border-dotted border-[hsl(var(--ink-faded))] mb-1 opacity-50"
          />
          <a
            href={`${explorerBase}/tx/${thread.pay_tx_hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="heading-sub text-[10px] no-underline hover:text-primary transition-colors shrink-0"
          >
            tx →
          </a>
        </div>
      </Card>
    </li>
  );
}
