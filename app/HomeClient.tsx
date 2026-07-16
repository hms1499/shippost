'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAccount, useConnect, useChainId } from 'wagmi';
import { formatUnits } from 'viem';
import { Loader2 } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { ScreenTransition } from '@/components/motion/ScreenTransition';
import { Stagger, StaggerItem } from '@/components/motion/Stagger';
import { useIsMiniPay } from '@/lib/minipay';
import { RuleDivider } from '@/components/terminal/RuleDivider';
import { ColophonIndex } from '@/components/ColophonIndex';

const WalletMenu = dynamic(
  () => import('@/components/WalletMenu').then((m) => m.WalletMenu),
  {
    ssr: false,
    loading: () => (
      <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border heading-sub text-[10px] text-muted-foreground">
        <Loader2 size={11} className="animate-spin text-muted-foreground" aria-hidden />
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
import type { NewsBreakdownSubmitPayload } from '@/components/NewsBreakdownInput';
import type { TokenAnalysisSubmitPayload } from '@/components/TokenAnalysisInput';
import type { DailyRecapSubmitPayload } from '@/components/DailyRecapInput';
import type { ChainComparisonSubmitPayload } from '@/components/ChainComparisonInput';
import { usePayForThread } from '@/lib/usePayForThread';
import { track } from '@/lib/funnel';
import { useThreadGeneration } from '@/hooks/useThreadGeneration';
import { explorerBase } from '@/lib/chains';
import { getContracts } from '@/lib/contracts';
import { computeTokenAmount } from '@/lib/tokens';
import { TARGET_CHAIN_ID, targetChainName, IS_TESTNET_TARGET } from '@/lib/targetChain';
import { fetchPreview, type PreviewArgs } from '@/lib/previewClient';
import { type Screen, isInputScreen, isOutputScreen } from '@/lib/screens';
import { CHAINS } from '@/lib/prompts/comparison';
import { useIsDesktop } from '@/lib/useIsDesktop';
import { useKeyboardInset } from '@/lib/useKeyboardInset';
import { ComposeSummary } from '@/components/ComposeSummary';

const EducationalInput = dynamic(
  () => import('@/components/EducationalInput').then((m) => m.EducationalInput),
  { ssr: false },
);
const HotTakeInput = dynamic(
  () => import('@/components/HotTakeInput').then((m) => m.HotTakeInput),
  { ssr: false },
);
const NewsBreakdownInput = dynamic(
  () => import('@/components/NewsBreakdownInput').then((m) => m.NewsBreakdownInput),
  { ssr: false },
);
const TokenAnalysisInput = dynamic(
  () => import('@/components/TokenAnalysisInput').then((m) => m.TokenAnalysisInput),
  { ssr: false },
);
const DailyRecapInput = dynamic(
  () => import('@/components/DailyRecapInput').then((m) => m.DailyRecapInput),
  { ssr: false },
);
const ChainComparisonInput = dynamic(
  () => import('@/components/ChainComparisonInput').then((m) => m.ChainComparisonInput),
  { ssr: false },
);
const AgentTrace = dynamic(
  () => import('@/components/AgentTrace').then((m) => m.AgentTrace),
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
  // When the webview keyboard opens it covers the bottom of the screen, where
  // the primary CTA lives. Add matching bottom scroll-room so the button can be
  // scrolled up above the keyboard instead of being trapped under it.
  const keyboardInset = useKeyboardInset();
  const chainId = useChainId();
  const onSupportedChain = chainId === TARGET_CHAIN_ID;

  const [screen, setScreen] = useState<Screen>('mode');
  const [submitted, setSubmitted] = useState<EducationalSubmitPayload | null>(null);
  const [hotTake, setHotTake] = useState<HotTakeSubmitPayload | null>(null);
  const [newsBreakdown, setNewsBreakdown] = useState<NewsBreakdownSubmitPayload | null>(null);
  const [tokenAnalysis, setTokenAnalysis] = useState<TokenAnalysisSubmitPayload | null>(null);
  const [dailyRecap, setDailyRecap] = useState<DailyRecapSubmitPayload | null>(null);
  const [comparison, setComparison] = useState<ChainComparisonSubmitPayload | null>(null);
  const [draftTweets, setDraftTweets] = useState<string[] | null>(null);
  const [previewData, setPreviewData] = useState<{ firstTweet: string; totalTweets: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [refundStatus, setRefundStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [refundError, setRefundError] = useState<string | null>(null);

  const activeToken =
    submitted?.token ?? hotTake?.token ?? newsBreakdown?.token ?? tokenAnalysis?.token ?? dailyRecap?.token ?? comparison?.token ?? null;
  const { pay, status, threadId, txHash, error, reset } = usePayForThread();
  const { state: gen, start: startGen, reset: resetGen } = useThreadGeneration();

  // When the user disconnects mid-flow, clear all transient state and return to
  // the mode picker. Without this, screens like 'generating' or 'preview' stay
  // visible with stale data after the wallet is gone.
  const prevConnected = useRef(false);
  const paidTracked = useRef<string | null>(null);
  useEffect(() => {
    if (prevConnected.current && !isConnected) {
      setScreen('mode');
      setSubmitted(null);
      setHotTake(null);
      setNewsBreakdown(null);
      setTokenAnalysis(null);
      setDailyRecap(null);
      setComparison(null);
      setDraftTweets(null);
      setPreviewData(null);
      setPreviewLoading(false);
      reset();
      resetGen();
    }
    if (!prevConnected.current && isConnected) {
      track('connect', { chainId, wallet: address ?? undefined });
    }
    prevConnected.current = isConnected;
  }, [isConnected, reset, resetGen, chainId, address]);

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
        eventContext: hotTake.eventContext,
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
    } else if (dailyRecap) {
      void startGen({
        threadId,
        chainId,
        walletAddress: address,
        tokenSymbol: dailyRecap.token.symbol,
        tokenAddress: dailyRecap.token.address,
        amountPaidRaw: computeTokenAmount(dailyRecap.token).toString(),
        payTxHash: txHash,
        // Daily Recap is input-free — no content fields ride along.
        mode: 3,
      });
    } else if (newsBreakdown) {
      void startGen({
        threadId,
        chainId,
        walletAddress: address,
        tokenSymbol: newsBreakdown.token.symbol,
        tokenAddress: newsBreakdown.token.address,
        amountPaidRaw: computeTokenAmount(newsBreakdown.token).toString(),
        payTxHash: txHash,
        mode: 5,
        eventDescription: newsBreakdown.eventDescription,
        eventContext: newsBreakdown.eventContext,
      });
    } else if (comparison) {
      void startGen({
        threadId,
        chainId,
        walletAddress: address,
        tokenSymbol: comparison.token.symbol,
        tokenAddress: comparison.token.address,
        amountPaidRaw: computeTokenAmount(comparison.token).toString(),
        payTxHash: txHash,
        mode: 4,
        // Both chains ride in on `topic` as "<aKey>|<bKey>".
        topic: `${comparison.aKey}|${comparison.bKey}`,
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
    dailyRecap,
    comparison,
    newsBreakdown,
    gen.hasStarted,
    gen.isDone,
    gen.fatal,
    chainId,
    startGen,
  ]);

  useEffect(() => {
    if (gen.isDone && gen.tweets && !gen.fatal) {
      if (draftTweets === null) {
        const mode: 0 | 1 | 2 | 3 | 4 | 5 =
          submitted ? 0 : hotTake ? 1 : tokenAnalysis ? 2 : dailyRecap ? 3 : comparison ? 4 : 5;
        track('share', { mode, chainId, wallet: address ?? undefined });
        setDraftTweets(gen.tweets);
      }
      setScreen('preview');
    }
  }, [gen.isDone, gen.tweets, gen.fatal, draftTweets, submitted, hotTake, tokenAnalysis, dailyRecap, comparison, newsBreakdown, chainId, address]);

  useEffect(() => {
    if (status === 'success' && threadId != null) {
      const key = threadId.toString();
      if (paidTracked.current !== key) {
        paidTracked.current = key;
        const mode: 0 | 1 | 2 | 3 | 4 | 5 =
          submitted ? 0 : hotTake ? 1 : tokenAnalysis ? 2 : dailyRecap ? 3 : comparison ? 4 : 5;
        track('pay', { mode, chainId, wallet: address ?? undefined });
      }
    }
  }, [status, threadId, submitted, hotTake, tokenAnalysis, dailyRecap, comparison, newsBreakdown, chainId, address]);

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
  // The ref guard covers the window before `previewLoading` re-renders the
  // form's disabled state — a double-tap must not fire a second preview.
  const previewInFlight = useRef(false);
  const beginFlow = useCallback(
    async (
      payload:
        | EducationalSubmitPayload
        | HotTakeSubmitPayload
        | NewsBreakdownSubmitPayload
        | TokenAnalysisSubmitPayload
        | DailyRecapSubmitPayload
        | ChainComparisonSubmitPayload,
      mode: 0 | 1 | 2 | 3 | 4 | 5,
    ) => {
      if (!address) return;
      if (previewInFlight.current) return;
      previewInFlight.current = true;
      track('submit', { mode, chainId, wallet: address });
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
            : mode === 3
              ? { mode: 3, walletAddress: address }
              : mode === 4
                ? {
                    mode: 4,
                    walletAddress: address,
                    topic: `${(payload as ChainComparisonSubmitPayload).aKey}|${(payload as ChainComparisonSubmitPayload).bKey}`,
                  }
                : mode === 5
                  ? {
                      mode: 5,
                      walletAddress: address,
                      eventDescription: (payload as NewsBreakdownSubmitPayload).eventDescription,
                      eventContext: (payload as NewsBreakdownSubmitPayload).eventContext,
                    }
                  : {
                    mode: 1,
                    walletAddress: address,
                    eventDescription: (payload as HotTakeSubmitPayload).eventDescription,
                    angle: (payload as HotTakeSubmitPayload).angle,
                    eventContext: (payload as HotTakeSubmitPayload).eventContext,
                  };
      try {
        const preview = await fetchPreview(args);
        setPreviewLoading(false);
        if (preview) {
          setPreviewData(preview);
          track('preview', { mode, chainId, wallet: address });
          setScreen('preview-locked');
        } else {
          setScreen('generating');
          await pay(payload.token, mode);
        }
      } finally {
        previewInFlight.current = false;
        setPreviewLoading(false);
      }
    },
    [address, chainId, pay],
  );

  const unlock = useCallback(async () => {
    const token =
      submitted?.token ?? hotTake?.token ?? newsBreakdown?.token ?? tokenAnalysis?.token ?? dailyRecap?.token ?? comparison?.token;
    if (!token) return;
    const mode: 0 | 1 | 2 | 3 | 4 | 5 =
      submitted ? 0 : hotTake ? 1 : tokenAnalysis ? 2 : dailyRecap ? 3 : comparison ? 4 : 5;
    setScreen('generating');
    await pay(token, mode);
  }, [submitted, hotTake, newsBreakdown, tokenAnalysis, dailyRecap, comparison, pay]);

  const formNode =
    screen === 'mode' ? (
      <ModePicker
        onSelect={(m) => {
          const mode =
            m === 'educational' ? 0
            : m === 'hot-take' ? 1
            : m === 'token-analysis' ? 2
            : m === 'daily-recap' ? 3
            : m === 'comparison' ? 4
            : 5;
          track('mode_select', { mode, chainId, wallet: address ?? undefined });
          if (m === 'educational') setScreen('educational');
          if (m === 'hot-take') setScreen('hot-take');
          if (m === 'news-breakdown') setScreen('news-breakdown');
          if (m === 'token-analysis') setScreen('token-analysis');
          if (m === 'daily-recap') setScreen('daily-recap');
          if (m === 'comparison') setScreen('comparison');
        }}
      />
    ) : screen === 'educational' ? (
      <EducationalInput
        onSubmit={async (p) => {
          setSubmitted(p);
          setHotTake(null);
          setNewsBreakdown(null);
          setTokenAnalysis(null);
          setDailyRecap(null);
          setComparison(null);
          await beginFlow(p, 0);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
        submitting={previewLoading}
      />
    ) : screen === 'hot-take' ? (
      <HotTakeInput
        onSubmit={async (p) => {
          setHotTake(p);
          setSubmitted(null);
          setNewsBreakdown(null);
          setTokenAnalysis(null);
          setDailyRecap(null);
          setComparison(null);
          await beginFlow(p, 1);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
        submitting={previewLoading}
      />
    ) : screen === 'news-breakdown' ? (
      <NewsBreakdownInput
        onSubmit={async (p) => {
          setNewsBreakdown(p);
          setSubmitted(null);
          setHotTake(null);
          setTokenAnalysis(null);
          setDailyRecap(null);
          setComparison(null);
          await beginFlow(p, 5);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
        submitting={previewLoading}
      />
    ) : screen === 'token-analysis' ? (
      <TokenAnalysisInput
        onSubmit={async (p) => {
          setTokenAnalysis(p);
          setSubmitted(null);
          setHotTake(null);
          setNewsBreakdown(null);
          setDailyRecap(null);
          setComparison(null);
          await beginFlow(p, 2);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
        submitting={previewLoading}
      />
    ) : screen === 'daily-recap' ? (
      <DailyRecapInput
        onSubmit={async (p) => {
          setDailyRecap(p);
          setSubmitted(null);
          setHotTake(null);
          setNewsBreakdown(null);
          setTokenAnalysis(null);
          setComparison(null);
          await beginFlow(p, 3);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
        submitting={previewLoading}
      />
    ) : screen === 'comparison' ? (
      <ChainComparisonInput
        onSubmit={async (p) => {
          setComparison(p);
          setSubmitted(null);
          setHotTake(null);
          setNewsBreakdown(null);
          setTokenAnalysis(null);
          setDailyRecap(null);
          await beginFlow(p, 4);
        }}
        onBack={() => setScreen('mode')}
        disabled={status === 'approving' || status === 'paying'}
        submitting={previewLoading}
      />
    ) : null;

  const resultNode =
    screen === 'preview-locked' && previewData ? (
      <PreviewLocked
        firstTweet={previewData.firstTweet}
        lockedCount={Math.max(previewData.totalTweets - 1, 0)}
        onUnlock={unlock}
        onRegenerate={() => {
          const payload = submitted ?? hotTake ?? tokenAnalysis ?? dailyRecap ?? comparison ?? newsBreakdown;
          if (payload) {
            void beginFlow(
              payload,
              submitted ? 0 : hotTake ? 1 : tokenAnalysis ? 2 : dailyRecap ? 3 : comparison ? 4 : 5,
            );
          }
        }}
        regenerating={previewLoading}
      />
    ) : screen === 'generating' ? (
      <AgentTrace
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
            <div className="rounded-md border border-border border-l-2 border-l-money bg-card px-4 py-3 flex flex-col gap-2.5">
              <p className="text-sm font-sans text-muted-foreground">
                Built without live data ({degradedSteps.join(', ')}). Still
                usable — or request a refund if it falls short.
              </p>
              {refundStatus === 'sent' ? (
                <p className="text-xs font-sans text-muted-foreground">
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
                <p className="text-xs font-sans text-destructive">{refundError}</p>
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
          {/* SELF-REPORTED signal: the app can't verify a post actually landed
              on X, only that the user clicked here. When the funnel is
              instrumented (C1), record this as a self-reported "claims posted"
              event — never as a verified share-rate. */}
          <Button onClick={() => setScreen('post-share')}>I posted it →</Button>
        </StaggerItem>
      </Stagger>
    ) : screen === 'post-share' && activeToken ? (
      <PostShareScreen
        threadId={threadId}
        paidAmountUsd={Number(
          formatUnits(computeTokenAmount(activeToken), activeToken.decimals),
        ).toFixed(3)}
        agentSpentUsd={gen.totalCostUsd ?? '0.001'}
        tokenSymbol={activeToken.symbol}
        payTxHash={txHash}
        steps={gen.steps}
        agentWalletAddress={getContracts(chainId).AgentWallet}
        explorerBase={explorerBase(chainId)}
        onReceiptCopied={() => track('receipt_copied', { chainId, wallet: address ?? undefined })}
        onWriteAnother={() => {
          reset();
          resetGen();
          setDraftTweets(null);
          setSubmitted(null);
          setHotTake(null);
          setNewsBreakdown(null);
          setTokenAnalysis(null);
          setDailyRecap(null);
          setComparison(null);
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
        <div className="w-full max-w-md rounded-md border border-border border-l-2 border-l-money bg-card px-4 py-3">
          <p className="text-sm font-sans text-muted-foreground leading-snug">
            Taking longer than usual — the agent is still working. Your payment
            is safe; if it can&apos;t finish, a refund is sent automatically.
          </p>
        </div>
      )}
      {error && /approve/i.test(error) && (
        <ErrorSurface
          kind="approve-rejected"
          onRetry={() => {
            const back: Screen = submitted ? 'educational' : hotTake ? 'hot-take' : newsBreakdown ? 'news-breakdown' : tokenAnalysis ? 'token-analysis' : dailyRecap ? 'daily-recap' : comparison ? 'comparison' : 'mode';
            reset();
            resetGen();
            setDraftTweets(null);
            setSubmitted(null);
            setHotTake(null);
            setNewsBreakdown(null);
            setTokenAnalysis(null);
            setDailyRecap(null);
            setComparison(null);
            setScreen(back);
          }}
        />
      )}
      {error && !/approve/i.test(error) && /revert|reject|fail/i.test(error) && (
        <ErrorSurface
          kind="pay-failed"
          onRetry={() => {
            const back: Screen = submitted ? 'educational' : hotTake ? 'hot-take' : newsBreakdown ? 'news-breakdown' : tokenAnalysis ? 'token-analysis' : dailyRecap ? 'daily-recap' : comparison ? 'comparison' : 'mode';
            reset();
            resetGen();
            setDraftTweets(null);
            setSubmitted(null);
            setHotTake(null);
            setNewsBreakdown(null);
            setTokenAnalysis(null);
            setDailyRecap(null);
            setComparison(null);
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
            setNewsBreakdown(null);
            setTokenAnalysis(null);
            setDailyRecap(null);
            setComparison(null);
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
  ) : dailyRecap ? (
    <ComposeSummary mode={3} tokenSymbol={dailyRecap.token.symbol} />
  ) : comparison ? (
    <ComposeSummary
      mode={4}
      chainA={CHAINS.find((c) => c.key === comparison.aKey)?.label ?? comparison.aKey}
      chainB={CHAINS.find((c) => c.key === comparison.bKey)?.label ?? comparison.bKey}
      tokenSymbol={comparison.token.symbol}
    />
  ) : newsBreakdown ? (
    <ComposeSummary
      mode={5}
      eventDescription={newsBreakdown.eventDescription}
      tokenSymbol={newsBreakdown.token.symbol}
    />
  ) : null;

  return (
    <main
      className="relative min-h-screen flex flex-col items-center gap-8 px-6 pt-[calc(2.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
      style={
        keyboardInset > 0
          ? { paddingBottom: `calc(1.5rem + env(safe-area-inset-bottom) + ${keyboardInset}px)` }
          : undefined
      }
    >
      <header className={`w-full ${spread ? 'max-w-4xl' : 'max-w-md'} flex flex-col gap-3`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col leading-none">
            <h1 className="font-mono font-bold tracking-tight text-[clamp(2.25rem,10.5vw,3.4rem)] text-foreground leading-[0.9]">
              CoinOp
            </h1>
            <span className="heading-sub text-[10px] mt-2">
              AI thread writer, agent-run
            </span>
          </div>
          <div className="flex flex-col items-end gap-2 pt-2 shrink-0">
            {mounted && <WalletMenu />}
          </div>
        </div>
        <RuleDivider />
      </header>

      {!mounted ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 size={14} className="animate-spin text-muted-foreground" aria-hidden />
          Loading…
        </div>
      ) : !isConnected ? (
        isMiniPay ? (
          miniPayTimeout ? (
            <div className="flex flex-col items-center gap-3 max-w-sm text-center">
              <p className="text-sm font-sans text-destructive">
                Could not connect to MiniPay. Try closing and reopening the app.
              </p>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 size={14} className="animate-spin text-muted-foreground" aria-hidden />
              Connecting MiniPay…
            </div>
          )
        ) : (
          <LandingHero />
        )
      ) : !onSupportedChain ? (
        isMiniPay ? (
          // MiniPay has no wallet_switchEthereumChain — a switch button would
          // fail silently. The chain is set by MiniPay's own "Use Testnet"
          // toggle, so guide the user there instead.
          <div className="flex flex-col items-center gap-3 max-w-sm text-center">
            <p className="text-sm font-sans text-destructive">
              Wrong network (chainId {chainId}). CoinOp runs on {targetChainName()}.
            </p>
            <p className="text-xs font-sans text-muted-foreground leading-snug">
              In MiniPay, open <span className="font-medium text-foreground">Settings → About</span>,
              tap the <span className="font-medium text-foreground">Version</span> number a few times to
              unlock <span className="font-medium text-foreground">Developer Settings</span>, then{' '}
              {IS_TESTNET_TARGET ? (
                <>turn <span className="font-medium text-foreground">Use Testnet on</span></>
              ) : (
                <>turn <span className="font-medium text-foreground">Use Testnet off</span></>
              )}{' '}
              and reopen CoinOp.
            </p>
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
            <div className="w-full max-w-4xl grid grid-cols-2 gap-8">
              <div className="w-full flex flex-col items-center gap-6">
                {isInputScreen(screen) ? formNode : composeSummary}
              </div>
              <div className="w-full flex flex-col items-center gap-6">
                {isOutputScreen(screen) && (
                  <div className="w-full flex flex-col items-center gap-4">
                    {resultNode}
                    {errorSurfaces}
                  </div>
                )}
              </div>
            </div>
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

      <footer className={`w-full ${spread ? 'max-w-4xl' : 'max-w-md'} flex flex-col items-center gap-4 mt-4`}>
        <RuleDivider />
        <ColophonIndex />
      </footer>
    </main>
  );
}
