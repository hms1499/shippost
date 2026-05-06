'use client';

import useSWR from 'swr';
import { Card } from '@/components/ui/card';

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

export default function StatsPage() {
  const { data: stats, error: statsError } = useSWR<Stats>('/api/public/analytics', fetcher, {
    refreshInterval: 30_000,
  });
  const { data: threadsData } = useSWR<{ threads: Thread[] }>(
    '/api/public/threads?limit=10',
    fetcher,
    { refreshInterval: 30_000 },
  );

  const threads = threadsData?.threads ?? [];

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-6 pt-8">
      <h1 className="text-3xl font-bold text-primary">ShipPost — live stats</h1>
      <p className="text-xs text-muted-foreground text-center max-w-md">
        Pulled from Supabase every 30s. All transactions on Celo mainnet (chainId 42220).
      </p>

      {statsError && (
        <p className="text-xs text-destructive">Failed to load stats. Try again later.</p>
      )}

      {stats && (
        <Card className="w-full max-w-md p-4 grid grid-cols-2 gap-4 text-sm">
          <Metric label="Threads" value={String(stats.threads)} />
          <Metric label="Unique wallets" value={String(stats.uniqueWallets)} />
          <Metric label="Volume" value={`$${stats.volumeUsd}`} />
          <Metric label="x402 payments" value={String(stats.x402Count)} />
          <Metric label="Repeat users" value={String(stats.repeatUsers)} />
        </Card>
      )}

      <section className="w-full max-w-md flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">Last 10 threads</h2>
        {threads.length === 0 && (
          <p className="text-xs text-muted-foreground">No mainnet threads yet.</p>
        )}
        {threads.map((t) => (
          <Card key={`${t.chain_id}-${t.onchain_thread_id}`} className="p-3 flex flex-col gap-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{new Date(t.created_at).toLocaleString()}</span>
              <span>
                {t.mode === 0 ? '🎓' : '🔥'} {t.token_symbol}
              </span>
            </div>
            <p className="text-sm line-clamp-2">{t.topic ?? '(no topic)'}</p>
            <a
              className="text-xs text-primary underline"
              href={`https://celoscan.io/tx/${t.pay_tx_hash}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Pay tx →
            </a>
          </Card>
        ))}
      </section>

      <a href="/" className="text-xs text-muted-foreground underline">
        ← Back to ShipPost
      </a>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}
