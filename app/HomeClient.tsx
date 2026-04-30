'use client';

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useChainId } from 'wagmi';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';
import { WalletStatus } from '@/components/WalletStatus';
import { ModePicker } from '@/components/ModePicker';
import { EducationalInput, type EducationalSubmitPayload } from '@/components/EducationalInput';
import { GeneratingStatus } from '@/components/GeneratingStatus';
import { usePayForThread } from '@/lib/usePayForThread';

type Screen = 'mode' | 'educational' | 'generating';

export default function HomeClient() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const isMiniPay = useIsMiniPay();
  const chainId = useChainId();

  const [screen, setScreen] = useState<Screen>('mode');
  const [submitted, setSubmitted] = useState<EducationalSubmitPayload | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const { pay, status, threadId, txHash, error, reset } = usePayForThread();

  useEffect(() => {
    if (isMiniPay && !isConnected && connectors[0]) {
      connect({ connector: connectors[0] });
    }
  }, [isMiniPay, isConnected, connect, connectors]);

  useEffect(() => {
    if (status === 'success' && threadId && submitted && !output) {
      (async () => {
        const res = await fetch('/api/x402/groq', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            threadId: threadId.toString(),
            topic: submitted.topic,
            audience: submitted.audience,
            length: submitted.length,
            mode: 0,
            chainId,
          }),
        });
        const json = await res.json();
        setOutput(json.output ?? json.error ?? 'No output');
      })();
    }
  }, [status, threadId, submitted, output, chainId]);

  const explorerBase =
    chainId === 42220 ? 'https://celoscan.io' : 'https://celo-sepolia.blockscout.com';

  async function handleEducationalSubmit(p: EducationalSubmitPayload) {
    setSubmitted(p);
    setScreen('generating');
    await pay(p.token, 0);
  }

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-6 pt-8">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold text-primary">ShipPost</h1>
        {isMiniPay && (
          <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
            MiniPay
          </span>
        )}
      </div>

      {!isConnected ? (
        <Button onClick={() => connect({ connector: connectors[0] })}>Connect wallet</Button>
      ) : (
        <>
          <WalletStatus />
          {screen === 'mode' && (
            <ModePicker
              onSelect={(m) => {
                if (m === 'educational') setScreen('educational');
              }}
            />
          )}
          {screen === 'educational' && (
            <EducationalInput
              onSubmit={handleEducationalSubmit}
              disabled={status === 'approving' || status === 'paying'}
            />
          )}
          {screen === 'generating' && (
            <GeneratingStatus
              txHash={txHash}
              threadId={threadId}
              mockOutput={output}
              chainExplorerBase={explorerBase}
            />
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {screen === 'generating' && status === 'success' && output && (
            <Button
              variant="outline"
              onClick={() => {
                reset();
                setOutput(null);
                setSubmitted(null);
                setScreen('mode');
              }}
            >
              Write another
            </Button>
          )}
        </>
      )}
    </main>
  );
}
