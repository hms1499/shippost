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
import { PayContext } from '@/components/PayContext';
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
import { track, captureSource } from '@/lib/funnel';
import { useThreadGeneration } from '@/hooks/useThreadGeneration';
import { explorerBase } from '@/lib/chains';
import { getContracts } from '@/lib/contracts';
import { computeTokenAmount, getTokens, type TokenSymbol } from '@/lib/tokens';
import { useBalances } from '@/lib/useBalances';
import { reselectTokenForChain } from '@/lib/chainChoice';
import { describeSwitchError } from '@/lib/payError';
import {
  SUPPORTED_CHAIN_IDS,
  DEFAULT_CHAIN_ID,
  isSupportedChain,
  isMiniPayChain,
  isTestnet,
  chainLabel,
} from '@/lib/chainPolicy';
import { fetchPreview, type PreviewArgs } from '@/lib/previewClient';
import { peekGuestTopic } from '@/lib/guestSession';
import { savePaidRun, loadPaidRun, clearPaidRun, isResumable, type PaidRun } from '@/lib/paidRun';
import { useResumeRun } from '@/hooks/useResumeRun';
import { ResumingRun } from '@/components/ResumingRun';
import { initialState as initialGenState } from '@/lib/threadGeneration';
import { fetchSpendReadiness, type SpendBlockReason } from '@/lib/preflight';
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

  // Record the top of the funnel once per session, tagging the acquisition
  // source (?ref=x from a share link). captureSource runs every mount (it is
  // first-touch internally); the visit event fires at most once per session so
  // client navigations don't double-count. Fires even for browser-only
  // visitors who never connect MiniPay — the true top of the funnel.
  useEffect(() => {
    captureSource();
    try {
      if (sessionStorage.getItem('coinop.funnel.visited')) return;
      sessionStorage.setItem('coinop.funnel.visited', '1');
    } catch {
      // storage blocked → fall through and fire once for this load
    }
    track('visit');
  }, []);

  // If MiniPay auto-connect hasn't resolved after 5s, surface an error instead
  // of spinning forever. Covers cases where the injected provider is unresponsive.
  const [miniPayTimeout, setMiniPayTimeout] = useState(false);

  const { isConnected, address, chainId: walletChainId } = useAccount();
  const { connect, connectors } = useConnect();
  const {
    switchChain,
    isPending: switching,
    variables: switchVars,
    error: switchError,
  } = useSwitchChain();
  const pendingChainId = switching ? switchVars?.chainId ?? null : null;
  const isMiniPay = useIsMiniPay();
  const isDesktop = useIsDesktop();
  const spread = !isMiniPay && isDesktop;
  // When the webview keyboard opens it covers the bottom of the screen, where
  // the primary CTA lives. Add matching bottom scroll-room so the button can be
  // scrolled up above the keyboard instead of being trapped under it.
  const keyboardInset = useKeyboardInset();
  const chainId = useChainId();
  // The wallet's real chain, not useChainId(): useChainId returns the config's
  // selected chain, which is clamped to a CONFIGURED chain. A wallet sitting on
  // Ethereum reports 8453 there, so the gate below could never fire and the app
  // rendered its whole flow "on Base" while the wallet was somewhere else.
  // useAccount().chainId is the connection's own chain, unclamped.
  const onSupportedChain = isSupportedChain(walletChainId ?? chainId);
  // MiniPay can only ever reach Celo, so the "Use Testnet" advice below must key
  // on which Celo chain we accept — not on the default, which may be Base.
  const minipayChain = SUPPORTED_CHAIN_IDS.find(isMiniPayChain);

  const [screen, setScreen] = useState<Screen>('mode');
  const [submitted, setSubmitted] = useState<EducationalSubmitPayload | null>(null);
  const [hotTake, setHotTake] = useState<HotTakeSubmitPayload | null>(null);
  const [newsBreakdown, setNewsBreakdown] = useState<NewsBreakdownSubmitPayload | null>(null);
  const [tokenAnalysis, setTokenAnalysis] = useState<TokenAnalysisSubmitPayload | null>(null);
  const [dailyRecap, setDailyRecap] = useState<DailyRecapSubmitPayload | null>(null);
  const [comparison, setComparison] = useState<ChainComparisonSubmitPayload | null>(null);
  const [draftTweets, setDraftTweets] = useState<string[] | null>(null);
  const [previewData, setPreviewData] = useState<{ firstTweet: string; totalTweets: number } | null>(null);
  // Says what a chain change did to the payment token, or why nothing here can
  // pay. Rendered above the form area.
  const [tokenSwitchNotice, setTokenSwitchNotice] = useState<string | null>(null);
  // The wallet sheet lives in WalletMenu but is also opened from the pay-moment
  // line, so its open state is owned here — one sheet, two ways in.
  const [walletOpen, setWalletOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [refundStatus, setRefundStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [refundError, setRefundError] = useState<string | null>(null);
  // Why the preflight stopped this run before charging. Only set alongside the
  // 'spend-unavailable' screen.
  const [spendBlockReason, setSpendBlockReason] = useState<SpendBlockReason | null>(null);
  // Held in state, not recomputed each render, because useResumeRun keys its
  // effect on this object's identity — an inline value would restart the poll
  // on every render.
  const [resumingRun, setResumingRun] = useState<PaidRun | null>(null);
  // The row's own numbers for a resumed receipt. Null during a live run, where
  // the SSE stream supplies them instead.
  const [resumedReceipt, setResumedReceipt] = useState<
    { amountPaidRaw: string | null; totalCostUsd: string } | null
  >(null);
  const restoreAttempted = useRef(false);
  const resumeApplied = useRef(false);

  const activeToken =
    submitted?.token ?? hotTake?.token ?? newsBreakdown?.token ?? tokenAnalysis?.token ?? dailyRecap?.token ?? comparison?.token ?? null;
  // A resumed run has no payload, so the token comes back from storage. Config
  // supplies the DECIMALS only — the amount comes from the row, below.
  const resumedToken = resumingRun
    ? (getTokens(resumingRun.chainId)[resumingRun.tokenSymbol as TokenSymbol] ?? null)
    : null;
  const receiptToken = activeToken ?? resumedToken;
  // Which form to return to when a run is handed back to the user (currently
  // only 'preview-unavailable'). Same precedence as `unlock()`'s mode pick.
  const inputScreenForActiveMode: Screen = submitted
    ? 'educational'
    : hotTake
      ? 'hot-take'
      : tokenAnalysis
        ? 'token-analysis'
        : dailyRecap
          ? 'daily-recap'
          : comparison
            ? 'comparison'
            : 'news-breakdown';
  const { pay, status, threadId, txHash, error, errorPhase, reset } = usePayForThread();
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
      // A run belongs to a wallet, and the wallet just left.
      clearPaidRun();
      setResumingRun(null);
      setResumedReceipt(null);
      resumeApplied.current = false;
      setPreviewData(null);
      setPreviewLoading(false);
      reset();
      resetGen();
    }
    if (!prevConnected.current && isConnected) {
      track('connect', { chainId, wallet: address ?? undefined });
      if (peekGuestTopic()) setScreen('educational');
    }
    prevConnected.current = isConnected;
  }, [isConnected, reset, resetGen, chainId, address]);

  // Reopening onto a paid run. One shot, latched by a ref: a user who moves on
  // from the resume screen must not be dragged back into it on a later render.
  useEffect(() => {
    if (!mounted || !isConnected || !address) return;
    if (restoreAttempted.current) return;
    restoreAttempted.current = true;

    const saved = loadPaidRun();
    if (!saved) return;
    if (!isResumable(saved, { now: Date.now(), wallet: address, chainId })) {
      // Wrong wallet, wrong chain, or too old to be this session's problem.
      clearPaidRun();
      return;
    }
    setResumingRun(saved);
    setScreen('resuming');
  }, [mounted, isConnected, address, chainId]);

  const resumeState = useResumeRun(resumingRun);

  // A resumed run rejoins the ordinary flow rather than growing a parallel one:
  // same preview screen, same downstream states.
  useEffect(() => {
    if (!resumingRun || resumeApplied.current) return;
    if (resumeState.state === 'done') {
      resumeApplied.current = true;
      setDraftTweets(resumeState.tweets);
      setResumedReceipt({
        amountPaidRaw: resumeState.amountPaidRaw,
        totalCostUsd: resumeState.totalCostUsd,
      });
      setScreen('preview');
      // The thread has been handed back; storage has done its job. resumingRun
      // itself is deliberately KEPT — post-share still reads the token symbol
      // and thread id from it, and the poll has already stopped.
      clearPaidRun();
    } else if (resumeState.state === 'failed') {
      resumeApplied.current = true;
      setScreen('mode');
      clearPaidRun();
      setResumingRun(null);
    }
  }, [resumeState, resumingRun]);

  // While a paid run is on screen, the first back press should return into the
  // app rather than close the webview, and a desktop reload should ask first.
  // Neither is load-bearing: if both fail, the resume path still recovers the
  // run. They exist so recovery is needed less often.
  useEffect(() => {
    if (screen !== 'generating') return;

    const marker = { coinop: 'run' };
    window.history.pushState(marker, '', window.location.href);

    const onPopState = () => {
      // Re-arm, so a second press is caught too. There is nowhere useful to go
      // back to mid-run: every earlier screen is a form whose payload is spent.
      window.history.pushState(marker, '', window.location.href);
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('popstate', onPopState);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [screen]);

  const autoConnectAttempted = useRef(false);
  // autoConnectAttempted is a one-way latch, so a retry button would do nothing
  // without both clearing it and giving the effect a reason to re-run.
  const [retryNonce, setRetryNonce] = useState(0);
  const retryMiniPayConnect = useCallback(() => {
    autoConnectAttempted.current = false;
    setMiniPayTimeout(false);
    setRetryNonce((n) => n + 1);
  }, []);
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
  }, [mounted, isMiniPay, isConnected, connect, connectors, retryNonce]);

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
        const payToken =
          submitted?.token ?? hotTake?.token ?? tokenAnalysis?.token ??
          dailyRecap?.token ?? comparison?.token ?? newsBreakdown?.token ?? null;
        if (txHash && address && payToken) {
          // Written before the SSE stream can finish, because the whole point is
          // surviving a client that does not live that long.
          savePaidRun({
            v: 1,
            chainId,
            threadId: key,
            payTxHash: txHash,
            mode,
            tokenSymbol: payToken.symbol,
            wallet: address.toLowerCase(),
            startedAt: Date.now(),
          });
        }
      }
    }
  }, [status, threadId, txHash, submitted, hotTake, tokenAnalysis, dailyRecap, comparison, newsBreakdown, chainId, address]);

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
          // The input screen states the preview is free, so a failed preview
          // must not silently become a 0.05 charge. Hand the decision back
          // instead — `unlock()` still runs the exact same pay() path once the
          // user chooses it.
          setScreen('preview-unavailable');
        }
      } finally {
        previewInFlight.current = false;
        setPreviewLoading(false);
      }
    },
    // `pay` is no longer called here — a failed preview hands control back to
    // the user instead of charging, so paying only happens via `unlock`.
    [address, chainId],
  );

  // The payment token is captured into the submitted payload, so a chain switch
  // mid-flow can leave one chain's token address pointed at another chain's
  // payment contract. Re-derive instead of discarding the user's work.
  const { balances, isLoading: balancesLoading, isError: balancesError } = useBalances();

  // Takes a symbol, not the TokenConfig reselectTokenForChain returns: the
  // payload fields are typed TokenBalance (TokenConfig plus a balance), so a
  // bare TokenConfig will not assign. The symbol came out of `balances`, so the
  // lookup always resolves.
  const applyToken = useCallback(
    (symbol: TokenSymbol) => {
      const token = balances.find((b) => b.symbol === symbol);
      if (!token) return;
      if (submitted) setSubmitted({ ...submitted, token });
      else if (hotTake) setHotTake({ ...hotTake, token });
      else if (tokenAnalysis) setTokenAnalysis({ ...tokenAnalysis, token });
      else if (dailyRecap) setDailyRecap({ ...dailyRecap, token });
      else if (comparison) setComparison({ ...comparison, token });
      else if (newsBreakdown) setNewsBreakdown({ ...newsBreakdown, token });
    },
    [balances, submitted, hotTake, tokenAnalysis, dailyRecap, comparison, newsBreakdown],
  );

  const prevChainId = useRef<number | null>(null);
  useEffect(() => {
    const previous = prevChainId.current;
    // First mount is not a change: the token the user just picked on this chain
    // must not be "re-derived" out from under them.
    if (previous === null) {
      prevChainId.current = chainId;
      return;
    }
    if (previous === chainId) return;

    // `balances` still describes the old chain until the refetch lands. Judging
    // the new chain by them would announce "no payable balance" for a chain we
    // have not looked at yet — so hold the change open (prevChainId unmoved)
    // and let this effect re-run once they settle.
    if (balancesLoading) return;
    prevChainId.current = chainId;

    // A failed read is not an empty wallet. WalletStatus already says the read
    // failed; inventing a token verdict on top of it would be a guess.
    if (balancesError) {
      setTokenSwitchNotice(null);
      return;
    }

    const active =
      submitted?.token ?? hotTake?.token ?? newsBreakdown?.token ??
      tokenAnalysis?.token ?? dailyRecap?.token ?? comparison?.token ?? null;

    // No payload means no captured payment token, so there is nothing to
    // re-derive and nothing to announce — the forms pick their own default.
    if (!active) {
      setTokenSwitchNotice(null);
      return;
    }

    const outcome = reselectTokenForChain({
      previousSymbol: active.symbol,
      chainId,
      balances,
    });

    if (outcome.kind === 'keep') {
      setTokenSwitchNotice(null);
      return;
    }
    if (outcome.kind === 'switched') {
      applyToken(outcome.symbol);
      setTokenSwitchNotice(`Now paying with ${outcome.symbol} on ${chainLabel(chainId)}`);
      return;
    }
    setTokenSwitchNotice(`No payable balance on ${chainLabel(chainId)}`);
    // applyToken is intentionally omitted: it changes identity on every balance
    // refetch, which would re-run this effect without the chain having changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    chainId,
    balances,
    balancesLoading,
    balancesError,
    submitted,
    hotTake,
    newsBreakdown,
    tokenAnalysis,
    dailyRecap,
    comparison,
  ]);

  // A notice describes one chain change; the next screen is a different question.
  useEffect(() => {
    setTokenSwitchNotice(null);
  }, [screen]);

  const unlock = useCallback(async () => {
    const token =
      submitted?.token ?? hotTake?.token ?? newsBreakdown?.token ?? tokenAnalysis?.token ?? dailyRecap?.token ?? comparison?.token;
    if (!token) return;
    // A zero balance would start a pay that reverts in the wallet. The `none`
    // outcome above has to actually block, not just narrate.
    const payable = balances.find((b) => b.symbol === token.symbol);
    if (!payable || payable.balance === 0n) {
      setTokenSwitchNotice(`No ${token.symbol} on ${chainLabel(chainId)}`);
      return;
    }
    const mode: 0 | 1 | 2 | 3 | 4 | 5 =
      submitted ? 0 : hotTake ? 1 : tokenAnalysis ? 2 : dailyRecap ? 3 : comparison ? 4 : 5;

    // This is the only path to pay(), including from 'preview-unavailable'. Ask
    // whether the agent can settle at all BEFORE the wallet sheet opens — a run
    // that provably cannot finish must never take the user's money. Fails open,
    // so an unreachable preflight leaves the existing flow untouched.
    const readiness = await fetchSpendReadiness(token.symbol, chainId);
    if (!readiness.ok) {
      setSpendBlockReason(readiness.reason);
      setScreen('spend-unavailable');
      return;
    }

    setScreen('generating');
    await pay(token, mode);
    // chainId is a real dependency: a stale one would preflight the chain the
    // user was on when this callback was last built, not the one they are
    // paying from.
  }, [submitted, hotTake, newsBreakdown, tokenAnalysis, dailyRecap, comparison, pay, chainId, balances]);

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
        tokenSymbol={activeToken?.symbol ?? null}
        // MiniPay gets no `change` link: there is nothing there to change.
        onChangeChain={isMiniPay ? undefined : () => setWalletOpen(true)}
      />
    ) : screen === 'preview-unavailable' && activeToken ? (
      <section className="w-full max-w-md flex flex-col gap-4">
        <div className="rounded-md border border-border border-l-2 border-l-money bg-card px-4 py-3 flex flex-col gap-2">
          <p className="heading-sub text-[10px]">Preview unavailable</p>
          <p className="text-sm font-sans text-muted-foreground leading-snug">
            The free preview didn&apos;t come back this time. You can generate the
            full thread now, or go back and try the preview again.
          </p>
        </div>
        <Button onClick={unlock}>
          Generate for{' '}
          {Number(
            formatUnits(computeTokenAmount(activeToken), activeToken.decimals),
          ).toFixed(2)}{' '}
          {activeToken.symbol} →
        </Button>
        <PayContext symbol={activeToken.symbol} />
        <button
          type="button"
          onClick={() => setScreen(inputScreenForActiveMode)}
          className="self-start flex items-center gap-1.5 heading-sub text-[10px] no-underline hover:text-primary transition-colors"
        >
          ← Back, try the preview again
        </button>
      </section>
    ) : screen === 'spend-unavailable' && spendBlockReason ? (
      <section className="w-full max-w-md flex flex-col gap-4">
        <ErrorSurface
          kind={
            spendBlockReason === 'paused'
              ? 'spend-paused'
              : spendBlockReason === 'gas'
                ? 'spend-gas'
                : 'spend-cap'
          }
          onRetry={() => {
            // The blocking condition may have cleared (unpaused, topped up, or
            // a new UTC day). Re-run the same guarded path rather than dropping
            // straight into pay().
            setSpendBlockReason(null);
            void unlock();
          }}
        />
        {activeToken && <PayContext symbol={activeToken.symbol} />}
        <button
          type="button"
          onClick={() => {
            setSpendBlockReason(null);
            setScreen(inputScreenForActiveMode);
          }}
          className="self-start flex items-center gap-1.5 heading-sub text-[10px] no-underline hover:text-primary transition-colors"
        >
          ← Back
        </button>
      </section>
    ) : screen === 'resuming' && resumingRun ? (
      <ResumingRun
        run={resumingRun}
        state={resumeState}
        onOpenHistory={() => {
          window.location.href = '/history';
        }}
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
    ) : screen === 'post-share' && receiptToken ? (
      <PostShareScreen
        threadId={threadId ?? (resumingRun ? BigInt(resumingRun.threadId) : null)}
        paidAmountUsd={
          // The row's amount is the on-chain VERIFIED one. Only when it is
          // absent does this fall back to the head price — which is exactly what
          // the live path already does today (audit finding 6.4/7.1, fixed in a
          // separate pass). This never makes the live path worse and makes the
          // resumed path right whenever the data exists.
          resumedReceipt?.amountPaidRaw
            ? Number(
                formatUnits(BigInt(resumedReceipt.amountPaidRaw), receiptToken.decimals),
              ).toFixed(3)
            : Number(
                formatUnits(computeTokenAmount(receiptToken), receiptToken.decimals),
              ).toFixed(3)
        }
        agentSpentUsd={gen.totalCostUsd ?? resumedReceipt?.totalCostUsd ?? '0.001'}
        tokenSymbol={receiptToken.symbol}
        payTxHash={txHash ?? resumingRun?.payTxHash ?? null}
        // No live run means no per-step costs were ever streamed, and the
        // database never stored any. settledCalls drops cost-less steps, so
        // PostShareScreen prints its single `agent spend` line instead of
        // per-call rows invented from X402_UNIT_COST_USD.
        steps={gen.hasStarted ? gen.steps : initialGenState.steps}
        agentWalletAddress={getContracts(chainId).AgentWallet}
        explorerBase={explorerBase(chainId)}
        onReceiptCopied={() => track('receipt_copied', { chainId, wallet: address ?? undefined })}
        onWriteAnother={() => {
          clearPaidRun();
          setResumingRun(null);
          setResumedReceipt(null);
          resumeApplied.current = false;
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
      {/* Every pay failure lands here — the kind comes from the recorded phase,
          never from matching the wallet's wording, so a message we didn't
          anticipate can no longer leave the user on a silent 'generating'
          screen with no card at all. */}
      {error && (
        <ErrorSurface
          kind={
            errorPhase === 'approve'
              ? 'approve-failed'
              : errorPhase === 'confirm'
                ? 'pay-unconfirmed'
                : errorPhase === 'setup'
                  ? 'wallet-unavailable'
                  : 'pay-failed'
          }
          detail={error}
          onRetry={() => {
            const back: Screen = submitted ? 'educational' : hotTake ? 'hot-take' : newsBreakdown ? 'news-breakdown' : tokenAnalysis ? 'token-analysis' : dailyRecap ? 'daily-recap' : comparison ? 'comparison' : 'mode';
            clearPaidRun();
            setResumingRun(null);
            setResumedReceipt(null);
            resumeApplied.current = false;
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
            clearPaidRun();
            setResumingRun(null);
            setResumedReceipt(null);
            resumeApplied.current = false;
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
            {mounted && <WalletMenu open={walletOpen} onOpenChange={setWalletOpen} />}
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
                Could not connect to MiniPay.
              </p>
              <Button onClick={retryMiniPayConnect}>Try again</Button>
              <p className="text-xs font-sans text-muted-foreground">
                Still stuck? Close and reopen CoinOp from the MiniPay app list.
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
              Wrong network (chainId {walletChainId ?? chainId}). CoinOp runs on{' '}
              {SUPPORTED_CHAIN_IDS.map(chainLabel).join(' or ')}.
            </p>
            {minipayChain === undefined ? (
              <p className="text-xs font-sans text-muted-foreground leading-snug">
                MiniPay only reaches Celo, and CoinOp is not accepting Celo payments right
                now. Open CoinOp in a wallet on{' '}
                <span className="font-medium text-foreground">{chainLabel(DEFAULT_CHAIN_ID)}</span>.
              </p>
            ) : (
              <p className="text-xs font-sans text-muted-foreground leading-snug">
                In MiniPay, open <span className="font-medium text-foreground">Settings → About</span>,
                tap the <span className="font-medium text-foreground">Version</span> number a few times to
                unlock <span className="font-medium text-foreground">Developer Settings</span>, then{' '}
                {isTestnet(minipayChain) ? (
                  <>turn <span className="font-medium text-foreground">Use Testnet on</span></>
                ) : (
                  <>turn <span className="font-medium text-foreground">Use Testnet off</span></>
                )}{' '}
                and reopen CoinOp.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 max-w-sm text-center">
            <p className="text-sm font-sans text-destructive">Wrong network</p>
            <p className="text-xs font-sans text-muted-foreground leading-snug">
              CoinOp runs on {SUPPORTED_CHAIN_IDS.map(chainLabel).join(' or ')}. Your
              wallet is on chainId {walletChainId ?? chainId}.
            </p>
            {/* Both chains are offered: forcing everyone onto DEFAULT_CHAIN_ID
                here would contradict the picker in the wallet sheet. The default
                stays the visually primary button. */}
            <div className="flex items-center gap-2">
              {SUPPORTED_CHAIN_IDS.map((id) => (
                <Button
                  key={id}
                  variant={id === DEFAULT_CHAIN_ID ? 'default' : 'outline'}
                  onClick={() =>
                    switchChain({
                      chainId: id as Parameters<typeof switchChain>[0]['chainId'],
                    })
                  }
                  disabled={switching}
                >
                  {pendingChainId === id ? 'Switching…' : `Switch to ${chainLabel(id)}`}
                </Button>
              ))}
            </div>
            {switchError && (
              <p className="font-mono text-[11px] text-destructive">
                {describeSwitchError(switchError)}
              </p>
            )}
          </div>
        )
      ) : (
        <>
          <WalletStatus />
          {tokenSwitchNotice && (
            <p className="font-mono text-[11px] text-muted-foreground text-center">
              {tokenSwitchNotice}
            </p>
          )}
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
