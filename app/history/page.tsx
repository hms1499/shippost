'use client';

import Link from 'next/link';
import { useAccount, useChainId } from 'wagmi';
import { ArrowLeft } from 'lucide-react';
import { HistoryList } from '@/components/HistoryList';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { explorerBase } from '@/lib/chains';
import { chainLabel } from '@/lib/chainPolicy';

export default function HistoryPage() {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  // The wallet's own chain, not useChainId(): useChainId returns the config's
  // selected chain, clamped to a configured one, so a wallet sitting elsewhere
  // would be shown another chain's history as if it were its own. Same reason
  // HomeClient reads it this way.
  const configChainId = useChainId();
  const chainId = walletChainId ?? configChainId;

  return (
    <main className="min-h-screen flex flex-col items-center p-6 pt-10">
      {/* One width for the whole page: header, rule and list cannot drift apart,
          and the column opens up to the folio on desktop instead of stranding
          448px of list in the middle of the screen. */}
      <div className="w-full max-w-md md:max-w-4xl flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            href="/"
            className="self-start flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors"
          >
            <ArrowLeft size={12} aria-hidden />
            Back to composer
          </Link>

          <div>
            <p className="heading-sub text-[10px]">My History · {chainLabel(chainId)}</p>
            <h1 className="text-2xl font-bold font-mono tracking-tight mt-1">History</h1>
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
      </div>
    </main>
  );
}
