'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/button';

export default function Home() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-bold text-primary">ShipPost</h1>
      {isConnected ? (
        <>
          <p className="text-muted-foreground text-sm font-mono">{address}</p>
          <Button onClick={() => disconnect()}>Disconnect</Button>
        </>
      ) : (
        <Button onClick={() => connect({ connector: connectors[0] })}>
          Connect wallet
        </Button>
      )}
    </main>
  );
}
