'use client';

import Link from 'next/link';
import { useAccount, useChainId } from 'wagmi';
import { ArrowLeft } from 'lucide-react';
import { HistoryList } from '@/components/HistoryList';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { explorerBase } from '@/lib/chains';

function chainLabel(chainId: number): string {
  if (chainId === 42220) return 'Celo mainnet';
  if (chainId === 11142220) return 'Celo Sepolia';
  return `chainId ${chainId}`;
}

export default function HistoryPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

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
            My History · {chainLabel(chainId)}
          </p>
          <h1 className="text-2xl font-bold font-mono tracking-tight mt-1">
            History
          </h1>
        </div>

        <p className="text-sm font-sans text-muted-foreground leading-snug">
          Every thread you&apos;ve run, in order. Tap a row to reopen its text and
          copy it again.
        </p>
      </header>

      <RuleDivider />

      {!isConnected || !address ? (
        <p className="text-sm font-sans text-muted-foreground">
          Connect a wallet to view your history.
        </p>
      ) : (
        <HistoryList
          walletAddress={address}
          chainId={chainId}
          explorerBase={explorerBase(chainId)}
        />
      )}
    </main>
  );
}
