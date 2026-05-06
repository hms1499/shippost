'use client';

import useSWR from 'swr';
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
  explorerBase: string;
}

export function HistoryList({ walletAddress, explorerBase }: Props) {
  const { data, isLoading, error } = useSWR<{ threads: Thread[] }>(
    `/api/public/threads?wallet=${walletAddress.toLowerCase()}&limit=50`,
    fetcher,
  );

  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (error)
    return <p className="text-xs text-destructive">Failed to load history.</p>;

  const threads = data?.threads ?? [];
  if (threads.length === 0)
    return (
      <p className="text-sm text-muted-foreground">No threads yet. Write your first one ↗</p>
    );

  return (
    <div className="w-full max-w-md flex flex-col gap-2">
      {threads.map((t) => (
        <Card
          key={`${t.chain_id}-${t.onchain_thread_id}`}
          className="p-3 flex flex-col gap-1"
        >
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{new Date(t.created_at).toLocaleString()}</span>
            <span>
              {t.mode === 0 ? '🎓 Educational' : '🔥 Hot Take'}
              {t.status !== 'completed' && (
                <span className="ml-2 text-destructive">[{t.status}]</span>
              )}
            </span>
          </div>
          <p className="text-sm font-medium line-clamp-1">{t.topic ?? '(no topic)'}</p>
          <div className="flex justify-between text-xs">
            <span className="font-mono">
              Paid 0.05 {t.token_symbol} · agent spent ${t.total_cost_usd ?? '—'}
            </span>
            <a
              className="text-primary underline"
              href={`${explorerBase}/tx/${t.pay_tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              tx →
            </a>
          </div>
        </Card>
      ))}
    </div>
  );
}
