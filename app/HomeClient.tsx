'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useConnect, useChainId, useSwitchChain } from 'wagmi';
import { celo } from 'wagmi/chains';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';
import { WalletStatus } from '@/components/WalletStatus';
import { ModePicker } from '@/components/ModePicker';
import { EducationalInput, type EducationalSubmitPayload } from '@/components/EducationalInput';
import { GeneratingStatus } from '@/components/GeneratingStatus';
import { usePayForThread } from '@/lib/usePayForThread';
import { explorerBase, isSupportedChain } from '@/lib/chains';
import { celoSepolia } from '@/lib/wagmi';

type Screen = 'mode' | 'educational' | 'generating';

export default function HomeClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const isMiniPay = useIsMiniPay();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const onSupportedChain = isSupportedChain(chainId);

  const [screen, setScreen] = useState<Screen>('mode');
  const [submitted, setSubmitted] = useState<EducationalSubmitPayload | null>(null);
  const [output, setOutput] = useState<string | null>(null);
  const { pay, status, threadId, txHash, error, reset } = usePayForThread();

  const autoConnectAttempted = useRef(false);
  useEffect(() => {
    if (!mounted) return;
    if (autoConnectAttempted.current) return;
    if (isMiniPay && !isConnected && connectors[0]) {
      autoConnectAttempted.current = true;
      try {
        connect({ connector: connectors[0] });
      } catch {
        autoConnectAttempted.current = false;
      }
    }
  }, [mounted, isMiniPay, isConnected, connect, connectors]);

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

  return (
    <main className="min-h-screen flex flex-col items-center gap-6 p-6 pt-8">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold text-primary">ShipPost</h1>
        {mounted && isMiniPay && (
          <span className="text-xs px-2 py-1 rounded-full bg-primary/20 text-primary">
            MiniPay
          </span>
        )}
      </div>

      {!mounted ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !isConnected ? (
        <div className="flex flex-col items-center gap-2 max-w-sm w-full">
          <p className="text-sm text-muted-foreground">Choose a wallet</p>
          {connectors.length === 0 ? (
            <p className="text-sm text-destructive">No wallet detected. Install MetaMask, Coinbase, Rainbow…</p>
          ) : (
            (() => {
              const seen = new Set<string>();
              const unique = connectors.filter((c) => {
                const key = c.name.toLowerCase();
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
              return unique.map((c) => (
                <Button
                  key={c.uid}
                  className="w-full"
                  variant="outline"
                  onClick={() => connect({ connector: c })}
                >
                  {c.name}
                </Button>
              ));
            })()
          )}
        </div>
      ) : !onSupportedChain ? (
        <div className="flex flex-col items-center gap-3 max-w-sm text-center">
          <p className="text-sm text-destructive">
            Wrong network (chainId {chainId}). ShipPost runs on Celo Sepolia (testnet) or Celo (mainnet).
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={isSwitching}
              onClick={() => switchChain({ chainId: celoSepolia.id })}
            >
              Switch to Celo Sepolia
            </Button>
            <Button
              variant="outline"
              disabled={isSwitching}
              onClick={() => switchChain({ chainId: celo.id })}
            >
              Switch to Celo
            </Button>
          </div>
        </div>
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
              onSubmit={async (p) => {
                setSubmitted(p);
                setScreen('generating');
                await pay(p.token, 0);
              }}
              disabled={status === 'approving' || status === 'paying'}
            />
          )}
          {screen === 'generating' && (
            <GeneratingStatus
              txHash={txHash}
              threadId={threadId}
              mockOutput={output}
              chainExplorerBase={explorerBase(chainId)}
            />
          )}
          {error && (
            <div className="flex flex-col items-center gap-2">
              <p className="text-sm text-destructive">{error}</p>
              {screen === 'generating' && (
                <Button
                  variant="outline"
                  onClick={() => {
                    reset();
                    setOutput(null);
                    setSubmitted(null);
                    setScreen(submitted ? 'educational' : 'mode');
                  }}
                >
                  Try again
                </Button>
              )}
            </div>
          )}
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
