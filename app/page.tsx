'use client';

import { useEffect } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';

export default function Home() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const isMiniPay = useIsMiniPay();

  // Auto-connect when detected in MiniPay webview
  useEffect(() => {
    if (isMiniPay && !isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [isMiniPay, isConnected, connect, connectors]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold text-primary">ShipPost</h1>
      {isMiniPay && (
        <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
          MiniPay detected
        </span>
      )}
      {isConnected ? (
        <>
          <p className="text-muted-foreground text-sm font-mono">{address}</p>
          {!isMiniPay && (
            <Button variant="outline" onClick={() => disconnect()}>
              Disconnect
            </Button>
          )}
        </>
      ) : (
        <Button onClick={() => connect({ connector: connectors[0] })}>
          Connect wallet
        </Button>
      )}
    </main>
  );
}
