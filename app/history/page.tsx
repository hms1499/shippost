'use client';

import Link from 'next/link';
import { useAccount, useChainId } from 'wagmi';
import { HistoryList } from '@/components/HistoryList';
import { explorerBase } from '@/lib/chains';

export default function HistoryPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  return (
    <main className="min-h-screen flex flex-col items-center gap-4 p-6 pt-8">
      <h1 className="text-2xl font-bold text-primary">My threads</h1>
      <Link href="/" className="text-xs underline text-muted-foreground">
        ← back to composer
      </Link>
      {!isConnected || !address ? (
        <p className="text-sm text-muted-foreground">Connect wallet to see your history.</p>
      ) : (
        <HistoryList walletAddress={address} explorerBase={explorerBase(chainId)} />
      )}
    </main>
  );
}
