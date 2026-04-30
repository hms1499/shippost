'use client';

import { useCallback, useState } from 'react';
import { useAccount, useChainId, usePublicClient, useWalletClient } from 'wagmi';
import { erc20Abi, decodeEventLog } from 'viem';
import { getContracts, shipPostPaymentAbi } from './contracts';
import { computeTokenAmount, type TokenConfig } from './tokens';

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
  txHash: string | null;
  error: string | null;
  pay: (token: TokenConfig, mode: 0 | 1) => Promise<void>;
  reset: () => void;
}

export function usePayForThread(): PayResult {
  const { address } = useAccount();
  const chainId = useChainId();
  const { data: walletClient, refetch: refetchWalletClient } = useWalletClient();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<PayStatus>('idle');
  const [threadId, setThreadId] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setThreadId(null);
    setTxHash(null);
    setError(null);
  }, []);

  const pay = useCallback(
    async (token: TokenConfig, mode: 0 | 1) => {
      if (!publicClient || !address || !chainId) {
        setError('Wallet not connected');
        setStatus('error');
        return;
      }
      let wc = walletClient ?? (await refetchWalletClient()).data;
      if (!wc) {
        setError('Wallet not connected');
        setStatus('error');
        return;
      }

      try {
        const contracts = getContracts(chainId);
        const paymentAddr = contracts.ShipPostPayment;
        const amount = computeTokenAmount(token);

        // Check current allowance
        const allowance = (await publicClient.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, paymentAddr],
        })) as bigint;

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
          abi: shipPostPaymentAbi as any,
          functionName: 'payForThread',
          args: [token.address, mode],
        });
        setTxHash(payHash);

        setStatus('waiting-confirmation');
        const receipt = await publicClient.waitForTransactionReceipt({ hash: payHash });

        // Find ThreadRequested event to extract threadId
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: shipPostPaymentAbi as any,
              data: log.data,
              topics: log.topics,
            }) as any;
            if (decoded.eventName === 'ThreadRequested') {
              setThreadId((decoded.args as any).threadId as bigint);
              break;
            }
          } catch {
            // not our event
          }
        }

        setStatus('success');
      } catch (e: any) {
        setError(e.shortMessage ?? e.message ?? 'Payment failed');
        setStatus('error');
      }
    },
    [walletClient, refetchWalletClient, publicClient, address, chainId]
  );

  return { status, threadId, txHash, error, pay, reset };
}
