'use client';

import { useEffect, useRef, useState } from 'react';
import { useAccount, useConnect, useChainId, useSwitchChain } from 'wagmi';
import { celo } from 'wagmi/chains';
import { formatUnits } from 'viem';
import { Button } from '@/components/ui/button';
import { useIsMiniPay } from '@/lib/minipay';
import { WalletStatus } from '@/components/WalletStatus';
import { ModePicker } from '@/components/ModePicker';
import { EducationalInput, type EducationalSubmitPayload } from '@/components/EducationalInput';
import { HotTakeInput, type HotTakeSubmitPayload } from '@/components/HotTakeInput';
import { GeneratingStatus } from '@/components/GeneratingStatus';
import { ThreadPreview } from '@/components/ThreadPreview';
import { ShareToX } from '@/components/ShareToX';
import { PostShareScreen } from '@/components/PostShareScreen';
import { ErrorSurface } from '@/components/ErrorSurface';
import { usePayForThread } from '@/lib/usePayForThread';
import { useThreadGeneration } from '@/hooks/useThreadGeneration';
import { explorerBase, isSupportedChain } from '@/lib/chains';
import { getContracts } from '@/lib/contracts';
import { computeTokenAmount } from '@/lib/tokens';
import { celoSepolia } from '@/lib/wagmi';

type Screen = 'mode' | 'educational' | 'hot-take' | 'generating' | 'preview' | 'post-share';

export default function HomeClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const { isConnected, address } = useAccount();
  const { connect, connectors } = useConnect();
  const isMiniPay = useIsMiniPay();
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const onSupportedChain = isSupportedChain(chainId);

  const [screen, setScreen] = useState<Screen>('mode');
  const [submitted, setSubmitted] = useState<EducationalSubmitPayload | null>(null);
  const [hotTake, setHotTake] = useState<HotTakeSubmitPayload | null>(null);
  const [draftTweets, setDraftTweets] = useState<string[] | null>(null);

  const activeToken = submitted?.token ?? hotTake?.token ?? null;
  const { pay, status, threadId, txHash, error, reset } = usePayForThread();
  const { state: gen, start: startGen, reset: resetGen } = useThreadGeneration();

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
    if (
      status !== 'success' ||
      !threadId ||
      !txHash ||
      !address ||
      gen.hasStarted ||
      gen.isDone ||
      gen.fatal
    ) {
      return;
    }
    if (submitted) {
      void startGen({
        threadId,
        chainId,
        walletAddress: address,
        tokenSymbol: submitted.token.symbol,
        tokenAddress: submitted.token.address,
        amountPaidRaw: computeTokenAmount(submitted.token).toString(),
        payTxHash: txHash,
        mode: 0,
        topic: submitted.topic,
        audience: submitted.audience,
      });
    } else if (hotTake) {
      void startGen({
        threadId,
        chainId,
        walletAddress: address,
        tokenSymbol: hotTake.token.symbol,
        tokenAddress: hotTake.token.address,
        amountPaidRaw: computeTokenAmount(hotTake.token).toString(),
        payTxHash: txHash,
        mode: 1,
        eventDescription: hotTake.eventDescription,
        angle: hotTake.angle,
      });
    }
  }, [
    status,
    threadId,
    txHash,
    address,
    submitted,
    hotTake,
    gen.hasStarted,
    gen.isDone,
    gen.fatal,
    chainId,
    startGen,
  ]);

  useEffect(() => {
    if (gen.isDone && gen.tweets && !gen.fatal) {
      if (draftTweets === null) setDraftTweets(gen.tweets);
      setScreen('preview');
    }
  }, [gen.isDone, gen.tweets, gen.fatal, draftTweets]);

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
                if (m === 'hot-take') setScreen('hot-take');
              }}
            />
          )}
          {screen === 'educational' && (
            <EducationalInput
              onSubmit={async (p) => {
                setSubmitted(p);
                setHotTake(null);
                setScreen('generating');
                await pay(p.token, 0);
              }}
              disabled={status === 'approving' || status === 'paying'}
            />
          )}
          {screen === 'hot-take' && (
            <HotTakeInput
              onSubmit={async (p) => {
                setHotTake(p);
                setSubmitted(null);
                setScreen('generating');
                await pay(p.token, 1);
              }}
              disabled={status === 'approving' || status === 'paying'}
            />
          )}
          {screen === 'generating' && (
            <GeneratingStatus
              gen={gen}
              payTxHash={txHash}
              threadId={threadId}
              chainExplorerBase={explorerBase(chainId)}
              agentWalletAddress={getContracts(chainId).AgentWallet}
            />
          )}
          {screen === 'preview' && draftTweets && (
            <div className="w-full max-w-md flex flex-col gap-3">
              <h2 className="text-lg font-semibold">Your thread is ready</h2>
              <ThreadPreview tweets={draftTweets} onChange={setDraftTweets} />
              <ShareToX tweets={draftTweets} />
              <Button onClick={() => setScreen('post-share')}>I posted it →</Button>
            </div>
          )}
          {screen === 'post-share' && activeToken && (
            <PostShareScreen
              paidAmountUsd={Number(
                formatUnits(computeTokenAmount(activeToken), activeToken.decimals),
              ).toFixed(3)}
              agentSpentUsd={gen.totalCostUsd ?? '0.001'}
              tokenSymbol={activeToken.symbol}
              payTxHash={txHash}
              agentWalletAddress={getContracts(chainId).AgentWallet}
              explorerBase={explorerBase(chainId)}
              onWriteAnother={() => {
                reset();
                resetGen();
                setDraftTweets(null);
                setSubmitted(null);
                setHotTake(null);
                setScreen('mode');
              }}
            />
          )}
          {error && /approve/i.test(error) && (
            <ErrorSurface
              kind="approve-rejected"
              onRetry={() => {
                const back: Screen = submitted ? 'educational' : hotTake ? 'hot-take' : 'mode';
                reset();
                resetGen();
                setDraftTweets(null);
                setSubmitted(null);
                setHotTake(null);
                setScreen(back);
              }}
            />
          )}
          {error && !/approve/i.test(error) && /revert|reject|fail/i.test(error) && (
            <ErrorSurface
              kind="pay-failed"
              onRetry={() => {
                const back: Screen = submitted ? 'educational' : hotTake ? 'hot-take' : 'mode';
                reset();
                resetGen();
                setDraftTweets(null);
                setSubmitted(null);
                setHotTake(null);
                setScreen(back);
              }}
            />
          )}
          {screen === 'generating' && gen.fatal === 'slow' && !gen.isDone && (
            <ErrorSurface
              kind="slow"
              onRefundRequest={() => {
                alert('Cancel + 50% refund requested. Operator will process within 24h.');
              }}
            />
          )}
          {screen === 'generating' && gen.fatal && gen.fatal !== 'slow' && !gen.tweets && (
            <ErrorSurface
              kind="full-fail"
              onRefundRequest={() => alert('Refund request received. Check Celoscan within 24h.')}
            />
          )}
          {screen === 'generating' && gen.fatal && gen.fatal !== 'slow' && gen.tweets && (
            <ErrorSurface
              kind="partial"
              onRefundRequest={() => alert('Partial refund requested.')}
            />
          )}
          {screen === 'generating' && gen.fatal && gen.fatal !== 'slow' && (
            <Button
              variant="outline"
              onClick={() => {
                reset();
                resetGen();
                setDraftTweets(null);
                setSubmitted(null);
                setHotTake(null);
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
