'use client';

import { useEffect } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';
import { WalletStatus } from '@/components/WalletStatus';

export default function Home() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const isMiniPay = useIsMiniPay();

  useEffect(() => {
    if (isMiniPay && !isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [isMiniPay, isConnected, connect, connectors]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-start gap-6 p-6 pt-12">
      <h1 className="text-4xl font-bold text-primary">ShipPost</h1>
      {isMiniPay && (
        <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
          MiniPay detected
        </span>
      )}
      {isConnected ? (
        <WalletStatus />
      ) : (
        <Button onClick={() => connect({ connector: connectors[0] })}>
          Connect wallet
        </Button>
      )}
    </main>
  );
}
