'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Check, X, Loader2, ChevronDown } from 'lucide-react';
import { CopyNib } from '@/components/CopyNib';
import { modeCode, threadLabel } from '@/lib/threadLabel';
import { useCopy } from '@/lib/useCopy';

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
        <Loader2 size={12} className="animate-spin text-muted-foreground" aria-hidden />
        Loading history…
      </p>
    );

  if (error)
    return (
      <p className="text-sm font-sans text-destructive">
        Failed to load history. Refresh to try again.
      </p>
    );

  const threads = data?.threads ?? [];

  if (threads.length === 0)
    return (
      <p className="text-sm font-sans text-muted-foreground">
        No threads yet — run your first one from the composer.
      </p>
    );

  return (
    <ol className="w-full flex flex-col list-none font-mono">
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
  // A paid thread lives in the DB, but until now this row's only action was an
  // outbound explorer link — so a user whose webview reloaded mid-run (or who
  // came back from the X composer to a dropped session) had no way to reach the
  // content they already paid for. Tapping a row now recovers it in place, and
  // never navigates out of the MiniPay webview.
  const [open, setOpen] = useState(false);
  const { copied, failed, copy } = useCopy();

  const tweets = thread.tweets ?? [];
  const bodyId = `thread-${thread.chain_id}-${thread.onchain_thread_id}`;
  const modeLabel = modeCode(thread.mode);

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
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full min-h-[44px] flex flex-col gap-0.5 py-2.5 text-left text-xs no-underline hover:bg-primary/5 transition-colors"
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
          <ChevronDown
            size={12}
            className={`shrink-0 text-muted-foreground/70 transition-transform ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </span>
        {/* threadLabel decodes the raw stored topic — a mode-4 row stores
            "<aKey>|<bKey>", which rendered here as literal "solana|base" — and
            names the input-free modes instead of dropping the line. */}
        <span className="block min-w-0 truncate text-[11px] text-muted-foreground/70">
          └ {threadLabel(thread)}
        </span>
      </button>

      {open && (
        <div id={bodyId} className="pb-3 flex flex-col gap-2">
          {tweets.length > 0 ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="heading-sub text-[10px]">
                  {tweets.length} {tweets.length === 1 ? 'tweet' : 'tweets'}
                </span>
                <button
                  type="button"
                  onClick={() => void copy(tweets.join('\n\n'))}
                  className="inline-flex items-center gap-1 h-9 px-2 font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors"
                >
                  {copied ? 'copied all' : failed ? 'clipboard blocked' : 'copy all'}
                </button>
              </div>
              <ol className="flex flex-col gap-2 list-none">
                {tweets.map((tw, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-border bg-card/60 p-2.5 flex items-start gap-2"
                  >
                    <span className="font-mono text-[10px] text-muted-foreground pt-1 shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <p className="flex-1 min-w-0 whitespace-pre-wrap font-sans text-[13px] leading-snug">
                      {tw}
                    </p>
                    <CopyNib text={tw} label={`Copy tweet ${i + 1}`} className="-mt-1" />
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="font-sans text-[11px] text-muted-foreground leading-snug">
              {thread.status === 'completed'
                ? 'No text saved for this run.'
                : thread.status === 'failed'
                  ? 'This run failed before delivery — it is refundable.'
                  : 'Still running — reopen this row in a moment.'}
            </p>
          )}

          <a
            href={`${explorerBase}/tx/${thread.pay_tx_hash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start inline-flex items-center h-9 font-mono text-[11px] text-muted-foreground/70 no-underline hover:text-primary transition-colors"
          >
            payment tx ↗
          </a>
        </div>
      )}
    </li>
  );
}
