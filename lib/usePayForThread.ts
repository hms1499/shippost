'use client';

import { useCallback, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useWalletClient } from 'wagmi';
import { erc20Abi, decodeEventLog, type Hex } from 'viem';
import { getContracts, shipPostPaymentAbi } from './contracts';
import { computeTokenAmount, type TokenConfig } from './tokens';
import { isSupportedChain } from './chains';

export type PayStatus =
  | 'idle'
  | 'approving'
  | 'paying'
  | 'waiting-confirmation'
  | 'success'
  | 'error';

export interface PayResult {
  status: PayStatus;
  threadId: bigint | null;
  txHash: Hex | null;
  error: string | null;
  pay: (token: TokenConfig, mode: 0 | 1) => Promise<void>;
  reset: () => void;
}

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
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient, refetch: refetchWalletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<PayStatus>('idle');
  const [threadId, setThreadId] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setThreadId(null);
    setTxHash(null);
    setError(null);
  }, []);

  const pay = useCallback(
    async (token: TokenConfig, mode: 0 | 1) => {
      if (!publicClient || !address) {
        setError('Wallet not connected');
        setStatus('error');
        return;
      }
      if (!isSupportedChain(chainId)) {
        setError(`Unsupported network (chainId ${chainId}). Switch to Celo or Celo Sepolia.`);
        setStatus('error');
        return;
      }
      const wc = walletClient ?? (await refetchWalletClient()).data;
      if (!wc) {
        setError('Wallet not connected');
        setStatus('error');
        return;
      }

      try {
        const contracts = getContracts(chainId);
        const paymentAddr = contracts.ShipPostPayment;
        const amount = computeTokenAmount(token);

        const allowance = await publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, paymentAddr],
        });

        if (allowance < amount) {
          setStatus('approving');
          const approveHash = await wc.writeContract({
            address: token.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [paymentAddr, amount],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
        }

        setStatus('paying');
        const payHash = await wc.writeContract({
          address: paymentAddr,
          abi: shipPostPaymentAbi,
          functionName: 'payForThread',
          args: [token.address, mode],
        });
        setTxHash(payHash);

        setStatus('waiting-confirmation');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: payHash });

        if (receipt.status !== 'success') {
          throw new Error('Payment transaction reverted');
        }

        const id = extractThreadId(receipt.logs);
        if (id === null) {
          throw new Error('Payment confirmed but ThreadRequested event not found in receipt');
        }

        setThreadId(id);
        setStatus('success');
      } catch (e) {
        const msg =
          (e as { shortMessage?: string }).shortMessage ??
          (e instanceof Error ? e.message : 'Payment failed');
        setError(msg);
        setStatus('error');
      }
    },
    [walletClient, refetchWalletClient, publicClient, address, chainId]
  );

  return { status, threadId, txHash, error, pay, reset };
}
