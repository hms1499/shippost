'use client';

import Link from 'next/link';
import { useAccount, useChainId } from 'wagmi';
import { ArrowLeft } from 'lucide-react';
import { HistoryList } from '@/components/HistoryList';
import { InkText } from '@/components/InkText';
import { InkDivider } from '@/components/InkDivider';
import { FolioMark } from '@/components/FolioMark';
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
        <div className="flex items-start justify-between">
          <Link
            href="/"
            className="self-start flex items-center gap-1.5 heading-sub text-[10px] no-underline hover:text-primary transition-colors"
          >
            <ArrowLeft size={12} aria-hidden />
            Back to composer
          </Link>
          <FolioMark numeral="III" />
        </div>

        <div>
          <p className="heading-sub text-[10px]">
            My History · {chainLabel(chainId)}
          </p>
          <InkText
            as="h1"
            className="font-display italic text-[2.6rem] leading-[0.95] mt-1"
            delay={50}
          >
            Your folios
          </InkText>
        </div>

        <p className="text-sm text-muted-foreground leading-snug">
          Every thread you&apos;ve composed, in the order they were inked.
        </p>
      </header>

      <InkDivider />

      {!isConnected || !address ? (
        <p className="text-sm text-muted-foreground">
          Connect a wallet to read your folios.
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
