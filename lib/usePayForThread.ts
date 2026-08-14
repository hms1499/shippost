'use client';

import { useCallback, useState } from 'react';
import { useAccount, useChainId, useConfig, usePublicClient, useWalletClient } from 'wagmi';
// From wagmi/actions, NOT @wagmi/core: this repo resolves two copies of
// @wagmi/core (wagmi 2.19 pins 2.22, package.json depends on 3.4 directly), and
// the Config that useConfig() returns is the 2.22 one. Importing the actions
// from the other copy makes every call a type error, so they come through wagmi
// itself — one Config type, one viem.
import {
  sendCalls,
  waitForCallsStatus,
  getCapabilities,
  type WaitForCallsStatusReturnType,
} from 'wagmi/actions';
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
import { type TokenConfig } from './tokens';
import { getChain } from './chains';
import { DEFAULT_CHAIN_ID, isSupportedChain, chainLabel } from './chainPolicy';
import { readThreadPrice } from './threadPrice';
import { buildPayCalls } from './payBundle';
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

// Approve a bounded batch instead of the exact price per thread, so a repeat
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

/**
 * The real transaction hash behind a settled EIP-5792 bundle.
 *
 * sendCalls hands back a bundle id, but /api/generate/stream verifies
 * payTxHash against an on-chain receipt — posting the bundle id would fail
 * verification for every sponsored payment. The last receipt is payForThread,
 * which is the call that emits ThreadRequested.
 *
 * The per-receipt status is checked as well as the bundle's: a bundle can
 * report success while the call inside it reverted, and returning that hash
 * would claim a payment landed when no money moved.
 */
export function resolveBundleTxHash(status: WaitForCallsStatusReturnType): Hex {
  if (status.status !== 'success') {
    throw new Error(`Payment bundle did not succeed (${status.status})`);
  }
  const last = status.receipts?.[status.receipts.length - 1];
  if (!last?.transactionHash) throw new Error('Payment bundle produced no receipt');
  if (last.status !== 'success') {
    throw new Error('Payment bundle settled but the payment call reverted');
  }
  return last.transactionHash as Hex;
}

export function usePayForThread(): PayResult {
  const { address, connector } = useAccount();
  const chainId = useChainId();
  const config = useConfig();
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
        // Authoritative price: one read feeds the approve amount, the consent
        // ceiling and the amount the user is shown. A locally computed price
        // can be stale the moment setPrice lands.
        const amount = await readThreadPrice({ publicClient, chainId, token });
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
        const needsApprove = allowance < amount;

        let sponsored = false;
        try {
          const caps = await getCapabilities(config, { account: address, chainId });
          sponsored = caps?.paymasterService?.supported === true;
        } catch {
          // A wallet that cannot answer wallet_getCapabilities is simply an EOA
          // wallet. Fall through to the unsponsored path rather than failing.
          sponsored = false;
        }

        if (sponsored) {
          phase = 'pay';
          setStatus('paying');
          haptic('tap');

          const calls = buildPayCalls({
            token,
            paymentAddr,
            price: amount,
            mode,
            needsApprove,
            approveBatch: APPROVE_BATCH,
          });

          const { id } = await sendCalls(config, {
            account: address,
            chainId,
            calls,
            capabilities: {
              paymasterService: {
                url: '/api/paymaster',
                // If the paymaster declines or is out of quota, the wallet
                // still submits the bundle with the user paying gas, instead
                // of failing the payment outright.
                optional: true,
              },
            },
          });

          phase = 'confirm';
          setStatus('waiting-confirmation');
          const settled = await waitForCallsStatus(config, { id });
          const bundlePayHash = resolveBundleTxHash(settled);
          setTxHash(bundlePayHash);

          const bundleReceipt = await publicClient.getTransactionReceipt({
            hash: bundlePayHash,
          });
          const bundledId = extractThreadId(bundleReceipt.logs);
          if (bundledId === null) {
            throw new Error('Payment confirmed but ThreadRequested event not found in receipt');
          }
          setThreadId(bundledId);
          setStatus('success');
          haptic('success');
          return;
        }

        // Unsponsored EOA path below — unchanged.
        if (needsApprove) {
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
    [walletClient, refetchWalletClient, publicClient, address, chainId, connector, config, fail]
  );

  return { status, threadId, txHash, error, errorPhase, pay, reset };
}
