'use client';

import { useCallback, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useWalletClient } from 'wagmi';
import {
  erc20Abi,
  decodeEventLog,
  createWalletClient,
  custom,
  type Hex,
  type WalletClient,
  type EIP1193Provider,
} from 'viem';
import { getContracts, shipPostPaymentAbi } from './contracts';
import { computeTokenAmount, type TokenConfig } from './tokens';
import { getChain } from './chains';
import { DEFAULT_CHAIN_ID, isSupportedChain, chainLabel } from './chainPolicy';
import { haptic } from './haptics';
import { getAttributionSuffix } from './attributionTag';
import { describePayError } from './payError';

export type PayStatus =
  | 'idle'
  | 'approving'
  | 'paying'
  | 'waiting-confirmation'
  | 'success'
  | 'error';

/**
 * Where the flow stood when it threw. The UI used to guess this by matching
 * the message against /approve/i, which silently showed nothing whenever the
 * wallet worded a failure some other way — the failure mode that hid the
 * first-payment bug. The phase is recorded, never inferred.
 */
export type PayPhase = 'setup' | 'approve' | 'pay' | 'confirm';

export interface PayResult {
  status: PayStatus;
  threadId: bigint | null;
  txHash: Hex | null;
  error: string | null;
  errorPhase: PayPhase | null;
  pay: (token: TokenConfig, mode: number) => Promise<void>;
  reset: () => void;
}

// Approve a bounded batch instead of the exact $0.05 per thread, so a repeat
// user only signs the approve once every APPROVE_BATCH threads — every pay in
// between is a single tx. Bounded (not maxUint256) so the standing allowance
// the payment contract holds on the user's token stays capped at ~$2.
const APPROVE_BATCH = 40n;

function extractThreadId(logs: readonly { data: Hex; topics: readonly Hex[] }[]): bigint | null {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: shipPostPaymentAbi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      if (decoded.eventName === 'ThreadRequested') {
        return decoded.args.threadId;
      }
    } catch {
      // not our event — continue
    }
  }
  return null;
}

export function usePayForThread(): PayResult {
  const { address, connector } = useAccount();
  const chainId = useChainId();
  const { data: walletClient, refetch: refetchWalletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<PayStatus>('idle');
  const [threadId, setThreadId] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorPhase, setErrorPhase] = useState<PayPhase | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setThreadId(null);
    setTxHash(null);
    setError(null);
    setErrorPhase(null);
  }, []);

  const fail = useCallback((phase: PayPhase, message: string) => {
    setError(message);
    setErrorPhase(phase);
    setStatus('error');
  }, []);

  const pay = useCallback(
    async (token: TokenConfig, mode: number) => {
      if (!address) {
        fail('setup', 'Wallet not connected');
        return;
      }
      if (!isSupportedChain(chainId)) {
        fail(
          'setup',
          `Wrong network. Switch your wallet to ${chainLabel(DEFAULT_CHAIN_ID)} (${DEFAULT_CHAIN_ID}).`,
        );
        return;
      }
      if (!publicClient) {
        fail('setup', `No RPC for chainId ${chainId}. Switch network in your wallet.`);
        return;
      }
      let wc: WalletClient | undefined = walletClient ?? undefined;
      if (!wc) {
        for (let i = 0; i < 10 && !wc; i++) {
          const refetched = (await refetchWalletClient()).data;
          if (refetched) {
            wc = refetched;
            break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      if (!wc && connector) {
        try {
          const provider = (await connector.getProvider()) as EIP1193Provider | undefined;
          if (provider) {
            wc = createWalletClient({
              account: address,
              chain: getChain(chainId),
              transport: custom(provider),
            });
          }
        } catch (e) {
          console.error('connector.getProvider() failed', e);
        }
      }
      if (!wc) {
        fail(
          'setup',
          `Wallet client not ready (connector=${connector?.name ?? 'none'}). Try Disconnect → reconnect.`,
        );
        return;
      }

      let phase: PayPhase = 'setup';
      try {
        const contracts = getContracts(chainId);
        const paymentAddr = contracts.ShipPostPayment;
        const amount = computeTokenAmount(token);
        const chain = getChain(chainId);

        let walletChainId = await wc.getChainId();
        if (walletChainId !== chainId) {
          try {
            await wc.switchChain({ id: chainId });
          } catch (e) {
            fail(
              'setup',
              `Wallet is on chainId ${walletChainId}; switch to ${chainLabel(chainId)} (${chainId}) in your wallet. ${describePayError(e)}`,
            );
            return;
          }
          for (let i = 0; i < 15 && walletChainId !== chainId; i++) {
            await new Promise((r) => setTimeout(r, 200));
            walletChainId = await wc.getChainId();
          }
          if (walletChainId !== chainId) {
            fail('setup', `Wallet is still on chainId ${walletChainId}; please switch to ${chainLabel(chainId)} (${chainId}) manually and retry.`);
            return;
          }
        }

        const allowance = await publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, paymentAddr],
        });

        if (allowance < amount) {
          phase = 'approve';
          setStatus('approving');
          const approveHash = await wc.writeContract({
            address: token.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [paymentAddr, amount * APPROVE_BATCH],
            account: address,
            chain,
            dataSuffix: getAttributionSuffix(chainId),
          });
          const approveReceipt = await publicClient.waitForTransactionReceipt({
            hash: approveHash,
          });
          // A reverted approve must NOT fall through to payForThread — that
          // pay would revert with "transfer amount exceeds allowance", charging
          // the user a second gas fee for a doomed tx. USDT approves are the
          // usual culprit: MiniPay pays gas in the token and can under-provision
          // the limit, so the approve runs out of gas. Retrying re-estimates and
          // typically succeeds.
          if (approveReceipt.status !== 'success') {
            throw new Error(
              'Token approval failed (the approve transaction reverted, usually the wallet under-funding gas). Please try again.',
            );
          }
          // MiniPay rewrites the approved amount, so trust the on-chain
          // allowance — not the receipt alone — before spending.
          const confirmedAllowance = await publicClient.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, paymentAddr],
          });
          if (confirmedAllowance < amount) {
            throw new Error('Token approval did not take effect. Please try again.');
          }
        }

        phase = 'pay';
        setStatus('paying');
        haptic('tap');
        const payHash = await wc.writeContract({
          address: paymentAddr,
          abi: shipPostPaymentAbi,
          functionName: 'payForThread',
          // maxAmount is the user's consent ceiling: exactly the amount this
          // flow computed and approved, never padded.
          args: [token.address, mode, amount],
          account: address,
          chain,
          dataSuffix: getAttributionSuffix(chainId),
        });
        setTxHash(payHash);

        phase = 'confirm';
        setStatus('waiting-confirmation');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: payHash });

        if (receipt.status !== 'success') {
          // A revert moves no funds, so this is the ordinary "pay failed, retry
          // safely" story — not the unconfirmed one, where the money may have
          // left and a second attempt would double-charge.
          phase = 'pay';
          throw new Error('Payment transaction reverted');
        }

        const id = extractThreadId(receipt.logs);
        if (id === null) {
          throw new Error('Payment confirmed but ThreadRequested event not found in receipt');
        }

        setThreadId(id);
        setStatus('success');
        haptic('success');
      } catch (e) {
        // The wallet's own wording is the only evidence for a webview-side
        // failure, so log it whole and keep the readable form for the UI.
        console.error(`payForThread failed during ${phase}`, e);
        fail(phase, describePayError(e));
        haptic('error');
      }
    },
    [walletClient, refetchWalletClient, publicClient, address, chainId, connector, fail]
  );

  return { status, threadId, txHash, error, errorPhase, pay, reset };
}
