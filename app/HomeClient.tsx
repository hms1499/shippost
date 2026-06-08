'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAccount, useConnect, useChainId, useSwitchChain } from 'wagmi';
import { formatUnits } from 'viem';
import { Loader2 } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { ScreenTransition } from '@/components/motion/ScreenTransition';
import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useIsMiniPay } from '@/lib/minipay';
import { FolioMark } from '@/components/FolioMark';
import { InkDivider } from '@/components/InkDivider';
import { MirrorScript } from '@/components/MirrorScript';
import { Marginalia } from '@/components/Marginalia';
import { InkBlot } from '@/components/InkBlot';
import { InkText } from '@/components/InkText';

const WalletMenu = dynamic(
  () => import('@/components/WalletMenu').then((m) => m.WalletMenu),
  {
    ssr: false,
    loading: () => (
      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[hsl(var(--ink-faded))] heading-sub text-[10px] text-muted-foreground">
        <Loader2 size={11} className="animate-spin text-[hsl(var(--ink-faded))]" aria-hidden />
        Loading…
      </span>
    ),
  },
);
import { WalletStatus } from '@/components/WalletStatus';
import { LandingHero } from '@/components/LandingHero';
import { ModePicker } from '@/components/ModePicker';
import { ErrorSurface } from '@/components/ErrorSurface';
import type { EducationalSubmitPayload } from '@/components/EducationalInput';
import type { HotTakeSubmitPayload } from '@/components/HotTakeInput';
import type { TokenAnalysisSubmitPayload } from '@/components/TokenAnalysisInput';
import { usePayForThread } from '@/lib/usePayForThread';
import { useThreadGeneration } from '@/hooks/useThreadGeneration';
import { explorerBase } from '@/lib/chains';
import { getContracts } from '@/lib/contracts';
import { computeTokenAmount } from '@/lib/tokens';
import { TARGET_CHAIN_ID, targetChainName } from '@/lib/targetChain';
import { fetchPreview, type PreviewArgs } from '@/lib/previewClient';
import { type Screen, isInputScreen, isOutputScreen } from '@/lib/screens';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { FolioSpread } from '@/components/FolioSpread';
import { ComposeSummary } from '@/components/ComposeSummary';
import { RightLeafPlaceholder } from '@/components/RightLeafPlaceholder';

const EducationalInput = dynamic(
  () => import('@/components/EducationalInput').then((m) => m.EducationalInput),
  { ssr: false },
);
const HotTakeInput = dynamic(
  () => import('@/components/HotTakeInput').then((m) => m.HotTakeInput),
  { ssr: false },
);
const TokenAnalysisInput = dynamic(
  () => import('@/components/TokenAnalysisInput').then((m) => m.TokenAnalysisInput),
  { ssr: false },
);
const GeneratingStatus = dynamic(
  () => import('@/components/GeneratingStatus').then((m) => m.GeneratingStatus),
  { ssr: false },
);
const ThreadPreview = dynamic(
  () => import('@/components/ThreadPreview').then((m) => m.ThreadPreview),
  { ssr: false },
);
const ShareToX = dynamic(
  () => import('@/components/ShareToX').then((m) => m.ShareToX),
  { ssr: false },
);
const PostShareScreen = dynamic(
  () => import('@/components/PostShareScreen').then((m) => m.PostShareScreen),
  { ssr: false },
);
const PreviewLocked = dynamic(
  () => import('@/components/PreviewLocked').then((m) => m.PreviewLocked),
  { ssr: false },
);

export default function HomeClient() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  // If MiniPay auto-connect hasn't resolved after 5s, surface an error instead
  // of spinning forever. Covers cases where the injected provider is unresponsive.
  const [miniPayTimeout, setMiniPayTimeout] = useState(false);

  const { isConnected, address } = useAccount();
  const { connect, connectors } = useConnect();
  const isMiniPay = useIsMiniPay();
  const isDesktop = useIsDesktop();
  const spread = !isMiniPay && isDesktop;
  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const onSupportedChain = chainId === TARGET_CHAIN_ID;

  const [screen, setScreen] = useState<Screen>('mode');
  const [submitted, setSubmitted] = useState<EducationalSubmitPayload | null>(null);
  const [hotTake, setHotTake] = useState<HotTakeSubmitPayload | null>(null);
  const [tokenAnalysis, setTokenAnalysis] = useState<TokenAnalysisSubmitPayload | null>(null);
  const [draftTweets, setDraftTweets] = useState<string[] | null>(null);
  const [previewData, setPreviewData] = useState<{ firstTweet: string; totalTweets: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [refundStatus, setRefundStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [refundError, setRefundError] = useState<string | null>(null);

  const activeToken = submitted?.token ?? hotTake?.token ?? tokenAnalysis?.token ?? null;
  const { pay, status, threadId, txHash, error, reset } = usePayForThread();
  const { state: gen, start: startGen, reset: resetGen } = useThreadGeneration();

  // When the user disconnects mid-flow, clear all transient state and return to
  // the mode picker. Without this, screens like 'generating' or 'preview' stay
  // visible with stale data after the wallet is gone.
  const prevConnected = useRef(false);
  useEffect(() => {
    if (prevConnected.current && !isConnected) {
      setScreen('mode');
      setSubmitted(null);
      setHotTake(null);
      setTokenAnalysis(null);
      setDraftTweets(null);
      setPreviewData(null);
      setPreviewLoading(false);
      reset();
      resetGen();
    }
    prevConnected.current = isConnected;
  }, [isConnected, reset, resetGen]);

  const autoConnectAttempted = useRef(false);
  useEffect(() => {
    if (!mounted) return;
    if (autoConnectAttempted.current) return;
    if (!isMiniPay || isConnected) return;
    // RainbowKit's getDefaultConfig adds many static connectors (MetaMask, Coinbase, WC) on top
    // of EIP-6963 discoveries — picking connectors[0] would grab a wallet that isn't actually
    // present in the MiniPay webview. Prefer the injected connector, which is what MiniPay
    // surfaces via window.ethereum.
    const injected =
      connectors.find((c) => c.id === 'injected') ??
      connectors.find((c) => c.name?.toLowerCase().includes('minipay')) ??
      connectors[0];
    if (!injected) return;
    autoConnectAttempted.current = true;
    try {
      connect({ connector: injected });
    } catch {
      autoConnectAttempted.current = false;
    }

    const timeout = setTimeout(() => {
      if (!isConnected) setMiniPayTimeout(true);
    }, 5000);
    return () => clearTimeout(timeout);
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
    } else if (tokenAnalysis) {
      void startGen({
        threadId,
        chainId,
        walletAddress: address,
        tokenSymbol: tokenAnalysis.token.symbol,
        tokenAddress: tokenAnalysis.token.address,
        amountPaidRaw: computeTokenAmount(tokenAnalysis.token).toString(),
        payTxHash: txHash,
        mode: 2,
        // Ticker rides in on `topic` — the server normalises it to $CASHTAG.
        topic: tokenAnalysis.ticker,
        angle: tokenAnalysis.angle,
      });
    }
  }, [
    status,
    threadId,
    txHash,
    address,
    submitted,
    hotTake,
    tokenAnalysis,
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

  // Reset refund UI state whenever a new generation starts (new threadId).
  useEffect(() => {
    setRefundStatus('idle');
    setRefundError(null);
  }, [threadId]);

  const requestRefund = useCallback(
    async (kind: 'full' | 'partial' | 'slow-cancel') => {
      if (!address || !threadId) return;
      setRefundStatus('sending');
      setRefundError(null);
      try {
        const res = await fetch('/api/refund-request', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            chainId,
            onchainThreadId: threadId.toString(),
            walletAddress: address,
            kind,
          }),
        });
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
        setRefundStatus('sent');
      } catch (e) {
        setRefundStatus('error');
        setRefundError(e instanceof Error ? e.message : 'request failed');
      }
    },
    [address, threadId, chainId],
  );

  // Soft steps that failed even after retry — thread is still usable but the
  // user paid full price for a degraded result. Surface a one-tap refund
  // request rather than silently keeping their money or auto-refunding.
  const degradedSteps = (['serper', 'coingecko', 'factCheck'] as const).filter(
    (s) => gen.steps[s]?.status === 'failed',
  );

  // AgentWallet.executeX402Call reverts with "CAP_EXCEEDED" once the daily
  // spend cap is hit; that string propagates verbatim into gen.fatal. Treat it
  // as a distinct, full-refundable outcome with its own copy instead of a
  // generic failure.
  const capHit = gen.fatal != null && /CAP_EXCEEDED/i.test(gen.fatal);

  // Try a free preview first; if it's unavailable for any reason, fall straight
  // through to the existing pay-first flow. A failed preview never blocks paying.
  const beginFlow = useCallback(
    async (
      payload: EducationalSubmitPayload | HotTakeSubmitPayload | TokenAnalysisSubmitPayload,
      mode: 0 | 1 | 2,
    ) => {
      if (!address) return;
      setPreviewLoading(true);
      const args: PreviewArgs =
        mode === 0
          ? {
              mode: 0,
              walletAddress: address,
              topic: (payload as EducationalSubmitPayload).topic,
              audience: (payload as EducationalSubmitPayload).audience,
            }
          : mode === 2
            ? {
                mode: 2,
                walletAddress: address,
                topic: (payload as TokenAnalysisSubmitPayload).ticker,
                angle: (payload as TokenAnalysisSubmitPayload).angle,
              }
            : {
                mode: 1,
                walletAddress: address,
                eventDescription: (payload as HotTakeSubmitPayload).eventDescription,
                angle: (payload as HotTakeSubmitPayload).angle,
              };
      const preview = await fetchPreview(args);
      setPreviewLoading(false);
      if (preview) {
        setPreviewData(preview);
        setScreen('preview-locked');
      } else {
        setScreen('generating');
        await pay(payload.token, mode);
      }
    },
    [address, pay],
  );

  const unlock = useCallback(async () => {
    const token = submitted?.token ?? hotTake?.token ?? tokenAnalysis?.token;
    if (!token) return;
    const mode: 0 | 1 | 2 = submitted ? 0 : hotTake ? 1 : 2;
    setScreen('generating');
    await pay(token, mode);
  }, [submitted, hotTake, tokenAnalysis, pay]);

  const formNode =
    screen === 'mode' ? (
      <ModePicker
        onSelect={(m) => {
          if (m === 'educational') setScreen('educational');
          if (m === 'hot-take') setScreen('hot-take');
          if (m === 'token-analysis') setScreen('token-analysis');
        }}
      />
    ) : screen === 'educational' ? (
      <EducationalInput
        onSubmit={async (p) => {
          setSubmitted(p);
          setHotTake(null);
          setTokenAnalysis(null);
          await beginFlow(p, 0);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
      />
    ) : screen === 'hot-take' ? (
      <HotTakeInput
        onSubmit={async (p) => {
          setHotTake(p);
          setSubmitted(null);
          setTokenAnalysis(null);
          await beginFlow(p, 1);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
      />
    ) : screen === 'token-analysis' ? (
      <TokenAnalysisInput
        onSubmit={async (p) => {
          setTokenAnalysis(p);
          setSubmitted(null);
          setHotTake(null);
          await beginFlow(p, 2);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
      />
    ) : null;

  const resultNode =
    screen === 'preview-locked' && previewData ? (
      <PreviewLocked
        firstTweet={previewData.firstTweet}
        lockedCount={Math.max(previewData.totalTweets - 1, 0)}
        onUnlock={unlock}
        onRegenerate={() => {
          const payload = submitted ?? hotTake ?? tokenAnalysis;
          if (payload) void beginFlow(payload, submitted ? 0 : hotTake ? 1 : 2);
        }}
        regenerating={previewLoading}
      />
    ) : screen === 'generating' ? (
      <GeneratingStatus
        gen={gen}
        payStatus={status}
        payTxHash={txHash}
        threadId={threadId}
        chainExplorerBase={explorerBase(chainId)}
        agentWalletAddress={getContracts(chainId).AgentWallet}
      />
    ) : screen === 'preview' && draftTweets ? (
      <Stagger className="w-full max-w-md flex flex-col gap-4">
        {degradedSteps.length > 0 && (
          <StaggerItem>
            <div className="rounded-md border border-[hsl(var(--ink-faded))] bg-[hsl(var(--ink-faded)/0.06)] px-4 py-3 flex flex-col gap-2.5">
              <p className="text-sm text-muted-foreground">
                Built without live data ({degradedSteps.join(', ')}). Still
                usable — or request a refund if it falls short.
              </p>
              {refundStatus === 'sent' ? (
                <p className="text-xs text-muted-foreground">
                  Refund requested. Operator will process within 24h.
                </p>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => requestRefund('partial')}
                  disabled={refundStatus === 'sending'}
                >
                  {refundStatus === 'sending' ? 'Sending…' : 'Request a refund'}
                </Button>
              )}
              {refundStatus === 'error' && refundError && (
                <p className="text-xs text-destructive">{refundError}</p>
              )}
            </div>
          </StaggerItem>
        )}
        <StaggerItem>
          <ThreadPreview tweets={draftTweets} onChange={setDraftTweets} />
        </StaggerItem>
        <StaggerItem>
          <ShareToX tweets={draftTweets} />
        </StaggerItem>
        <StaggerItem>
          <Button onClick={() => setScreen('post-share')}>I posted it →</Button>
        </StaggerItem>
      </Stagger>
    ) : screen === 'post-share' && activeToken ? (
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
          setTokenAnalysis(null);
          setScreen('mode');
        }}
      />
    ) : null;

  const errorSurfaces = (
    <>
      {/* Advisory only — the stall watchdog noticed no forward progress for a
          while, but the run is NOT cancelled and the outcome is still the
          server's to decide. No button: any refund follows from the server's
          own fatal/done. */}
      {screen === 'generating' && gen.isSlow && !gen.isDone && !gen.fatal && (
        <div className="w-full max-w-md rounded-md border border-[hsl(var(--ink-faded))] bg-[hsl(var(--ink-faded)/0.06)] px-4 py-3">
          <p className="text-sm text-muted-foreground leading-snug">
            Taking longer than usual — the agent is still working. Your payment
            is safe; if it can&apos;t finish, a refund is sent automatically.
          </p>
        </div>
      )}
      {error && /approve/i.test(error) && (
        <ErrorSurface
          kind="approve-rejected"
          onRetry={() => {
            const back: Screen = submitted ? 'educational' : hotTake ? 'hot-take' : tokenAnalysis ? 'token-analysis' : 'mode';
            reset();
            resetGen();
            setDraftTweets(null);
            setSubmitted(null);
            setHotTake(null);
            setTokenAnalysis(null);
            setScreen(back);
          }}
        />
      )}
      {error && !/approve/i.test(error) && /revert|reject|fail/i.test(error) && (
        <ErrorSurface
          kind="pay-failed"
          onRetry={() => {
            const back: Screen = submitted ? 'educational' : hotTake ? 'hot-take' : tokenAnalysis ? 'token-analysis' : 'mode';
            reset();
            resetGen();
            setDraftTweets(null);
            setSubmitted(null);
            setHotTake(null);
            setTokenAnalysis(null);
            setScreen(back);
          }}
        />
      )}
      {screen === 'generating' && capHit && (
        <ErrorSurface
          kind="cap-hit"
          onRefundRequest={() => requestRefund('full')}
          refundStatus={refundStatus}
          refundError={refundError}
        />
      )}
      {screen === 'generating' && !capHit && gen.fatal && !gen.tweets && (
        <ErrorSurface
          kind="full-fail"
          onRefundRequest={() => requestRefund('full')}
          refundStatus={refundStatus}
          refundError={refundError}
        />
      )}
      {screen === 'generating' && !capHit && gen.fatal && gen.tweets && (
        <ErrorSurface
          kind="partial"
          onRefundRequest={() => requestRefund('partial')}
          refundStatus={refundStatus}
          refundError={refundError}
        />
      )}
      {screen === 'generating' && gen.fatal && (
        <Button
          variant="outline"
          onClick={() => {
            reset();
            resetGen();
            setDraftTweets(null);
            setSubmitted(null);
            setHotTake(null);
            setTokenAnalysis(null);
            setScreen('mode');
          }}
        >
          Write another
        </Button>
      )}
    </>
  );

  const composeSummary = submitted ? (
    <ComposeSummary
      mode={0}
      topic={submitted.topic}
      audience={submitted.audience}
      tokenSymbol={submitted.token.symbol}
    />
  ) : hotTake ? (
    <ComposeSummary
      mode={1}
      eventDescription={hotTake.eventDescription}
      angle={hotTake.angle}
      tokenSymbol={hotTake.token.symbol}
    />
  ) : tokenAnalysis ? (
    <ComposeSummary
      mode={2}
      ticker={tokenAnalysis.ticker}
      angle={tokenAnalysis.angle}
      tokenSymbol={tokenAnalysis.token.symbol}
    />
  ) : null;

  return (
    <main className="relative min-h-screen flex flex-col items-center gap-6 px-6 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      {/* Decorative ink stains, light theme only — pulled to edges so they
          don't sit on top of content. dark:hidden keeps MiniPay clean. */}
      <InkBlot
        variant={1}
        size={42}
        className="pointer-events-none absolute top-32 left-3 text-[hsl(var(--ink-deep))] opacity-[0.06] dark:hidden -rotate-12"
      />
      <InkBlot
        variant={2}
        size={32}
        className="pointer-events-none absolute top-[60vh] right-4 text-[hsl(var(--ink-deep))] opacity-[0.05] dark:hidden rotate-[18deg]"
      />

      <header className={`w-full ${spread ? 'max-w-4xl' : 'max-w-md'} flex flex-col gap-3`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col leading-none">
            <InkText
              as="h1"
              className="font-display italic text-[3.4rem] text-foreground leading-[0.9]"
              delay={70}
            >
              ShipPost
            </InkText>
            <span className="heading-sub text-[10px] mt-2 flex items-center gap-2">
              Codex of Threads · Folio MMXXVI
              <MirrorScript className="font-display italic text-[12px] opacity-50 normal-case tracking-normal text-[hsl(var(--ink-faded))]">
                ShipPost
              </MirrorScript>
            </span>
          </div>
          <div className="flex flex-col items-end gap-2 pt-2 shrink-0">
            {mounted && <WalletMenu />}
            <FolioMark numeral="I" />
          </div>
        </div>
        <InkDivider />
        {mounted && !isMiniPay && (
          <Marginalia side="right" className="-mt-1 self-end">
            $0.05 per thread, paid in stable
          </Marginalia>
        )}
      </header>

      {!mounted ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-[hsl(var(--ink-faded))]" aria-hidden />
          Loading…
        </div>
      ) : !isConnected ? (
        isMiniPay ? (
          miniPayTimeout ? (
            <div className="flex flex-col items-center gap-3 max-w-sm text-center">
              <p className="text-sm text-destructive">
                Could not connect to MiniPay. Try closing and reopening the app.
              </p>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-[hsl(var(--ink-faded))]" aria-hidden />
              Connecting MiniPay…
            </div>
          )
        ) : (
          <LandingHero />
        )
      ) : !onSupportedChain ? (
        isMiniPay ? (
          <div className="flex flex-col items-center gap-3 max-w-sm text-center">
            <p className="text-sm text-destructive">
              Wrong network (chainId {chainId}). ShipPost runs on {targetChainName()}.
            </p>
            <Button
              variant="outline"
              disabled={isSwitching}
              onClick={() => switchChain({ chainId: TARGET_CHAIN_ID })}
            >
              {isSwitching ? (
                <>
                  <Loader2 size={14} className="animate-spin" aria-hidden />
                  Switching…
                </>
              ) : (
                'Switch to Celo'
              )}
            </Button>
          </div>
        ) : (
          <div className="text-sm text-destructive text-center max-w-sm">
            Wrong network. Use the wallet button above to switch to {targetChainName()}.
          </div>
        )
      ) : (
        <>
          <WalletStatus />
          {spread ? (
            <FolioSpread
              leftKey={isInputScreen(screen) ? screen : 'summary'}
              rightKey={isOutputScreen(screen) ? screen : 'placeholder'}
              left={isInputScreen(screen) ? formNode : composeSummary}
              right={
                isOutputScreen(screen) ? (
                  <div className="w-full flex flex-col items-center gap-4">
                    {resultNode}
                    {errorSurfaces}
                  </div>
                ) : (
                  <RightLeafPlaceholder />
                )
              }
            />
          ) : (
            <>
              <AnimatePresence mode="wait">
                <ScreenTransition key={screen}>
                  {isInputScreen(screen) ? formNode : resultNode}
                </ScreenTransition>
              </AnimatePresence>
              {errorSurfaces}
            </>
          )}
        </>
      )}

      <footer className={`w-full ${spread ? 'max-w-4xl' : 'max-w-md'} flex justify-center mt-4`}>
        <InkDivider />
      </footer>
    </main>
  );
}
