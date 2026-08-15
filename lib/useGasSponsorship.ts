'use client';

import { useEffect, useState } from 'react';
import { useAccount, useChainId, useConfig } from 'wagmi';
import { getCapabilities } from 'wagmi/actions';

export type SponsorshipState = 'unknown' | 'sponsored' | 'self';

/**
 * The gas half of the pay-moment line, or nothing.
 *
 * `unknown` renders nothing on purpose. Sponsorship is only knowable by asking
 * the wallet, and a wallet that cannot answer wallet_getCapabilities is the
 * common case (MiniPay is one). Claiming "no gas" there would be a promise
 * broken at exactly the moment the user is deciding whether to trust us.
 */
export function gasNote(state: SponsorshipState): string | null {
  if (state === 'sponsored') return 'no gas';
  if (state === 'self') return 'you pay gas';
  return null;
}

/**
 * Ask once per account+chain whether this wallet can have its gas sponsored.
 *
 * This is a wallet-local call, not an RPC — it costs nothing on the network.
 * It runs here, on connect, rather than inside pay() where it lives today,
 * because the answer has to be on screen BEFORE the user commits.
 */
export function useGasSponsorship(): SponsorshipState {
  const config = useConfig();
  const chainId = useChainId();
  const { address, isConnected } = useAccount();
  const [state, setState] = useState<SponsorshipState>('unknown');

  useEffect(() => {
    let cancelled = false;
    if (!isConnected || !address) {
      setState('unknown');
      return;
    }
    // Re-probing per chain matters: the same wallet is sponsored on Base and
    // not on Celo.
    setState('unknown');
    getCapabilities(config, { account: address, chainId })
      .then((caps) => {
        if (cancelled) return;
        setState(caps?.paymasterService?.supported === true ? 'sponsored' : 'self');
      })
      .catch(() => {
        if (!cancelled) setState('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [config, chainId, address, isConnected]);

  return state;
}
