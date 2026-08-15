'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useDisconnect, useSwitchChain } from 'wagmi';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  History,
  Loader2,
  LogOut,
  Wallet,
  X as XIcon,
} from 'lucide-react';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useIsMiniPay } from '@/lib/minipay';
import { DEFAULT_CHAIN_ID, chainLabel, SUPPORTED_CHAIN_IDS } from '@/lib/chainPolicy';
import { describeSwitchError } from '@/lib/payError';
import { useBalances } from '@/lib/useBalances';
import { buildChainOptions, type TokenBalanceLike } from '@/lib/chainChoice';
import { useGasSponsorship, gasNote } from '@/lib/useGasSponsorship';
import { ChainPicker } from '@/components/ChainPicker';
import { RuleDivider } from '@/components/terminal/RuleDivider';

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Custom RainbowKit chip + bottom-sheet menu. Account-only — site navigation
 * lives in the footer ColophonIndex, not here. Three visible states:
 *   1. Pre-connect (web)        — "Sign in" pill, opens RainbowKit modal.
 *   2. Pre-connect (MiniPay)    — "Connecting…" spinner pill (auto-connect runs in HomeClient).
 *   3. Connected                — address chip; click opens a terminal-styled
 *                                 sheet where copy / history / disconnect are
 *                                 each one tap (no RainbowKit account modal).
 */
interface WalletMenuProps {
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
}

export function WalletMenu({ open: openProp, onOpenChange }: WalletMenuProps = {}) {
  const [openSelf, setOpenSelf] = useState(false);
  // Controlled when a parent passes `open`, uncontrolled otherwise — so the
  // existing `<WalletMenu />` call sites keep working untouched, and there is
  // still exactly one sheet however it gets opened.
  const open = openProp ?? openSelf;
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenSelf(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const [copied, setCopied] = useState(false);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const lastFocusedRef = useRef<HTMLElement | null>(null);

  useBodyScrollLock(open);

  useEffect(() => {
    if (open) {
      lastFocusedRef.current = document.activeElement as HTMLElement | null;
      requestAnimationFrame(() => closeBtnRef.current?.focus());
    } else {
      lastFocusedRef.current?.focus?.();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, setOpen]);

  // Reset the copy tick whenever the sheet closes so it never reopens stale.
  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
    } catch {
      // Older webviews / unfocused documents: fall back to execCommand.
      try {
        const ta = document.createElement('textarea');
        ta.value = address;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {
        return; // silently keep "copy" — better than a broken confirmation
      }
    }
    setCopied(true);
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
  }

  const isMiniPay = useIsMiniPay();
  const { connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching, variables: switchVars, error: switchError, reset: resetSwitch } =
    useSwitchChain();

  const pendingChainId = switching ? switchVars?.chainId ?? null : null;
  const switchMessage = switchError ? describeSwitchError(switchError) : null;

  // DEFAULT_CHAIN_ID and any picker chainId are plain numbers while switchChain
  // wants one of the ids wagmi has registered. chainPolicy only ever yields ids
  // that lib/wagmi registers, so casting here keeps the two in step without
  // hardcoding a literal.
  const selectChain = (id: number) => {
    resetSwitch();
    switchChain(
      { chainId: id as Parameters<typeof switchChain>[0]['chainId'] },
      { onSuccess: () => setOpen(false) },
    );
  };
  const connectorLabel = isMiniPay ? 'MiniPay' : connector?.name ?? null;
  const chainId = useChainId();

  // useIsMiniPay returns false on first render (before its effect runs). If we
  // render "Sign in" immediately, MiniPay users see a flash of the web CTA
  // before the auto-connect kicks in. Hold the connect button until after one
  // commit so isMiniPay has had a chance to flip to true.
  const [confirmedNotMiniPay, setConfirmedNotMiniPay] = useState(false);
  useEffect(() => {
    setConfirmedNotMiniPay(true);
  }, []);

  // Balances for the chain the wallet is NOT on are only worth an RPC call once
  // the sheet is actually open — both public endpoints rate-limit (mainnet.base.org
  // bursts, forno.celo.org drops transactions).
  const otherChainId = SUPPORTED_CHAIN_IDS.find((id) => id !== chainId);
  const otherReady = open && otherChainId !== undefined;
  const current = useBalances();
  const other = useBalances({ chainId: otherChainId, enabled: otherReady });

  const failedChainIds: number[] = [];
  if (current.isError) failedChainIds.push(chainId);
  if (otherChainId !== undefined && other.isError) failedChainIds.push(otherChainId);

  const balancesByChain: Record<number, readonly TokenBalanceLike[] | undefined> = {
    [chainId]: current.isLoading || current.isError ? undefined : current.balances,
  };
  if (otherChainId !== undefined) {
    // Not-yet-requested is not the same as loaded-and-empty: while the sheet is
    // shut the query is disabled and the hook returns a zero-filled array nobody
    // read. Showing that as fact is the false-zero bug one layer up.
    balancesByChain[otherChainId] =
      !otherReady || other.isLoading || other.isError ? undefined : other.balances;
  }

  const sponsorship = useGasSponsorship();
  // Sponsorship was probed for the connected chain only; claiming anything about
  // the other chain would be a guess.
  const gasNoteFor = (id: number) => (id === chainId ? gasNote(sponsorship) : null);

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openConnectModal,
        mounted,
        authenticationStatus,
      }) => {
        const ready = mounted && authenticationStatus !== 'loading';
        const connected =
          ready &&
          !!account &&
          !!chain &&
          (!authenticationStatus || authenticationStatus === 'authenticated');

        if (!ready) {
          return <ChipShell loading>Loading…</ChipShell>;
        }

        if (!connected) {
          if (isMiniPay) {
            return <ChipShell loading>Connecting MiniPay…</ChipShell>;
          }
          if (!confirmedNotMiniPay) {
            // Detection still settling — show neutral spinner instead of
            // flashing the web "Sign in" CTA on MiniPay devices.
            return <ChipShell loading>Loading…</ChipShell>;
          }
          return (
            <button
              type="button"
              onClick={openConnectModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-primary bg-primary text-primary-foreground heading-sub text-[10px] hover:bg-primary/90 transition-colors"
            >
              <Wallet size={11} aria-hidden />
              Sign in
            </button>
          );
        }

        if (chain.unsupported) {
          // MiniPay can't switch chains from a dapp — the full-screen gate in
          // HomeClient tells the user how to toggle it in wallet settings, so
          // here it's a non-interactive indicator, not a (failing) switch button.
          if (isMiniPay) {
            return (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-destructive bg-[hsl(var(--destructive)/0.1)] text-destructive heading-sub text-[10px]">
                Wrong network
              </span>
            );
          }
          return (
            <button
              type="button"
              onClick={() => selectChain(DEFAULT_CHAIN_ID)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-destructive bg-[hsl(var(--destructive)/0.1)] text-destructive heading-sub text-[10px] hover:bg-[hsl(var(--destructive)/0.2)] transition-colors"
            >
              Wrong network
            </button>
          );
        }

        return (
          <>
            <div className="flex flex-col items-end gap-1">
              <button
                type="button"
                onClick={() => setOpen(true)}
                aria-label="Open account menu"
                aria-haspopup="dialog"
                aria-expanded={open}
                className={
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-card transition-colors ' +
                  (isMiniPay
                    ? 'border-primary/50 hover:border-primary'
                    : 'border-border hover:border-primary/50')
                }
              >
                <span
                  className="block w-1.5 h-1.5 rounded-full bg-primary"
                  aria-hidden
                />
                <span className="heading-sub text-[10px] text-muted-foreground">
                  {chainLabel(chainId).toUpperCase()}
                </span>
                <span className="font-mono text-[11px] text-foreground">
                  {shorten(account.address)}
                </span>
              </button>
              {connectorLabel && (
                <span
                  className={
                    'font-mono text-[11px] leading-none ' +
                    (isMiniPay
                      ? 'text-primary'
                      : 'text-muted-foreground')
                  }
                >
                  via {connectorLabel}
                </span>
              )}
            </div>

            <AnimatePresence>
              {open && (
                <>
                  <motion.div
                    key="bd"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => setOpen(false)}
                    className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
                    aria-hidden
                  />

                  <motion.div
                    key="sh"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="wallet-menu-title"
                    initial={{ y: '100%' }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', damping: 28, stiffness: 240 }}
                    className="fixed bottom-0 left-0 right-0 z-50 bg-card border-t border-border rounded-t-2xl shadow-[0_-12px_40px_-8px_hsl(var(--background)/0.7)]"
                  >
                    <div className="w-full max-w-md mx-auto px-6 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))] flex flex-col gap-4">
                      <div
                        className="self-center w-10 h-1 rounded-full bg-muted-foreground/35"
                        aria-hidden
                      />

                      <div className="flex items-baseline justify-between gap-3">
                        <h2
                          id="wallet-menu-title"
                          className="heading-sub text-[10px]"
                        >
                          Account · {chain.name}
                        </h2>
                        <button
                          ref={closeBtnRef}
                          type="button"
                          onClick={() => setOpen(false)}
                          aria-label="Close menu"
                          className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground no-underline hover:text-destructive transition-colors"
                        >
                          <XIcon size={11} aria-hidden />
                          close
                        </button>
                      </div>

                      <div className="rounded-md border border-border p-3 flex flex-col gap-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="w-1.5 h-1.5 rounded-full bg-primary shrink-0"
                              aria-hidden
                            />
                            <span className="font-mono text-sm text-foreground truncate">
                              {shorten(account.address)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => copyAddress(account.address)}
                            className={
                              'flex items-center gap-1 font-mono text-[11px] no-underline transition-colors shrink-0 ' +
                              (copied
                                ? 'text-primary'
                                : 'text-muted-foreground hover:text-primary')
                            }
                          >
                            {copied && <Check size={11} aria-hidden />}
                            {copied ? 'copied' : 'copy'}
                          </button>
                        </div>
                        {connectorLabel && (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                            <Wallet size={10} aria-hidden />
                            Connected via {connectorLabel}
                          </p>
                        )}
                      </div>

                      <RuleDivider />

                      <Link
                        href="/history"
                        onClick={() => setOpen(false)}
                        className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors self-start"
                      >
                        <History size={11} aria-hidden />
                        My History
                      </Link>

                      {isMiniPay ? (
                        <div className="flex flex-col gap-1.5">
                          <p className="heading-sub text-[10px]">Pay on</p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            <span className="text-foreground">{chainLabel(chainId).toUpperCase()}</span>
                            {' · MiniPay runs on Celo only'}
                          </p>
                        </div>
                      ) : (
                        <ChainPicker
                          options={buildChainOptions({
                            currentChainId: chainId,
                            balancesByChain,
                            failedChainIds,
                          })}
                          pendingChainId={pendingChainId}
                          error={switchMessage}
                          gasNoteFor={gasNoteFor}
                          onSelect={selectChain}
                        />
                      )}

                      {/* In MiniPay the wallet is the host app — nothing to
                          sign out of, and HomeClient's one-shot auto-connect
                          would leave the chip wedged at "Connecting…". */}
                      {!isMiniPay && (
                        <button
                          type="button"
                          onClick={() => {
                            setOpen(false);
                            disconnect();
                          }}
                          className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground no-underline hover:text-destructive transition-colors self-start"
                        >
                          <LogOut size={11} aria-hidden />
                          Disconnect
                        </button>
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </>
        );
      }}
    </ConnectButton.Custom>
  );
}

function ChipShell({
  children,
  loading,
}: {
  children: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border heading-sub text-[10px] text-muted-foreground">
      {loading && (
        <Loader2
          size={11}
          className="animate-spin text-muted-foreground"
          aria-hidden
        />
      )}
      {children}
    </span>
  );
}
