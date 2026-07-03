'use client';

import { useEffect, useRef, useState } from 'react';
import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeftRight, Loader2, Wallet, X as XIcon } from 'lucide-react';
import { useBodyScrollLock } from '@/lib/useBodyScrollLock';
import { useIsMiniPay } from '@/lib/minipay';
import { TARGET_CHAIN_ID, targetChainName } from '@/lib/targetChain';
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
 *                                 menu with wallet management and chain switching.
 */
export function WalletMenu() {
  const [open, setOpen] = useState(false);
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
  }, [open]);

  const isMiniPay = useIsMiniPay();
  const { connector } = useAccount();
  const { switchChain } = useSwitchChain();
  const switchToTarget = () => switchChain({ chainId: TARGET_CHAIN_ID });
  const connectorLabel = isMiniPay ? 'MiniPay' : connector?.name ?? null;
  // Track current chain to hide the switch button when already on target chain
  const chainId = useChainId();
  const isOnTargetChain = chainId === TARGET_CHAIN_ID;

  // useIsMiniPay returns false on first render (before its effect runs). If we
  // render "Sign in" immediately, MiniPay users see a flash of the web CTA
  // before the auto-connect kicks in. Hold the connect button until after one
  // commit so isMiniPay has had a chance to flip to true.
  const [confirmedNotMiniPay, setConfirmedNotMiniPay] = useState(false);
  useEffect(() => {
    setConfirmedNotMiniPay(true);
  }, []);

  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
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
              onClick={switchToTarget}
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
                            onClick={() => {
                              setOpen(false);
                              openAccountModal();
                            }}
                            className="font-mono text-[11px] text-muted-foreground no-underline hover:text-primary transition-colors shrink-0"
                          >
                            manage →
                          </button>
                        </div>
                        {connectorLabel && (
                          <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                            <Wallet size={10} aria-hidden />
                            Connected via {connectorLabel}
                          </p>
                        )}
                      </div>

                      {/* MiniPay can't switch chains from a dapp; the switch
                          action only makes sense on web wallets. */}
                      {!isOnTargetChain && !isMiniPay && (
                        <>
                          <RuleDivider />
                          <button
                            type="button"
                            onClick={() => {
                              setOpen(false);
                              switchToTarget();
                            }}
                            className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground no-underline hover:text-destructive transition-colors self-start"
                          >
                            <ArrowLeftRight size={11} aria-hidden />
                            Switch to {targetChainName()}
                          </button>
                        </>
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
