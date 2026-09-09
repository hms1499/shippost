'use client';

import Link from 'next/link';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId } from 'wagmi';
import { ArrowLeft, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { HistoryList } from '@/components/HistoryList';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { explorerBase } from '@/lib/chains';
import { chainLabel } from '@/lib/chainPolicy';

export default function HistoryPage() {
  const { address, isConnected, chainId: walletChainId } = useAccount();
  const { openConnectModal } = useConnectModal();
  // The wallet's own chain, not useChainId(): useChainId returns the config's
  // selected chain, clamped to a configured one, so a wallet sitting elsewhere
  // would be shown another chain's history as if it were its own. Same reason
  // HomeClient reads it this way.
  const configChainId = useChainId();
  const chainId = walletChainId ?? configChainId;

  return (
    <main id="main-content" className="min-h-dvh flex flex-col items-center p-6 pt-10">
      {/* One width for the whole page: header, rule and list cannot drift apart,
          and the column opens up to the folio on desktop instead of stranding
          448px of list in the middle of the screen. */}
      <div className="w-full max-w-md md:max-w-4xl flex flex-col gap-6">
        <header className="flex flex-col gap-3">
          <Link
            href="/"
            className="self-start inline-flex min-h-11 items-center gap-1.5 px-1 -mx-1 rounded font-mono text-xs text-muted-foreground no-underline hover:text-primary active:bg-primary/10 transition-colors"
          >
            <ArrowLeft size={12} aria-hidden />
            Back to composer
          </Link>

          <div>
            <p className="heading-sub text-xs">My History · {chainLabel(chainId)}</p>
            <h1 className="text-2xl font-bold font-mono tracking-tight mt-1">History</h1>
          </div>

          <p className="text-sm font-sans text-muted-foreground leading-snug">
            Every thread you&apos;ve run, in order. Tap a row to reopen its text and
            copy it again.
          </p>
        </header>

        <RuleDivider />

        {!isConnected || !address ? (
          <section className="rounded-md border border-border bg-card p-5 flex flex-col items-start gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="font-mono text-lg font-bold">Reconnect your history</h2>
              <p className="text-sm font-sans text-muted-foreground leading-relaxed">
                Connect the wallet you used with CoinOp to reopen paid threads and copy them again.
              </p>
            </div>
            <Button onClick={() => openConnectModal?.()} disabled={!openConnectModal}>
              <Wallet size={16} aria-hidden />
              Connect wallet
            </Button>
          </section>
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
