import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  safeWallet,
  rainbowWallet,
  base as baseWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { celoSepolia, getChain } from './chains';
import { SUPPORTED_CHAIN_IDS, DEFAULT_CHAIN_ID } from './chainPolicy';
import { rpcTransport } from './rpc';

export { celoSepolia };

// RainbowKit's getDefaultConfig requires a non-empty projectId at module load.
// Falling back to a placeholder lets builds succeed without WC configured;
// at runtime the WalletConnect option will fail to init but injected/Coinbase
// wallets still work, which covers MiniPay (the priority surface).
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'coinop-placeholder';

// Default chain first: wagmi treats chains[0] as the one to connect to when the
// wallet offers no opinion.
const orderedIds = [
  DEFAULT_CHAIN_ID,
  ...SUPPORTED_CHAIN_IDS.filter((id) => id !== DEFAULT_CHAIN_ID),
];
const chains = orderedIds.map(getChain) as [
  ReturnType<typeof getChain>,
  ...ReturnType<typeof getChain>[],
];

export const wagmiConfig = getDefaultConfig({
  appName: 'CoinOp',
  projectId,
  // MiniPay only surfaces window.ethereum (no EIP-6963), so the injected
  // connector must be configured explicitly — RainbowKit's default wallet
  // list omits it, leaving auto-connect nothing to attach to. Keep it first;
  // HomeClient auto-connect looks it up by id 'injected'.
  // metaMaskWallet is deliberately absent: the MetaMask extension (and the
  // MetaMask Mobile in-app browser) inject window.ethereum, so the generic
  // injectedWallet covers it, and its optional SDK was being pulled into the
  // bundle for a connector nobody opens by name. walletConnectWallet stays —
  // it is how a desktop visitor pairs a phone wallet over QR.
  wallets: [
    {
      groupName: 'Popular',
      wallets: [
        injectedWallet,
        safeWallet,
        rainbowWallet,
        baseWallet,
        walletConnectWallet,
      ],
    },
  ],
  chains,
  transports: Object.fromEntries(orderedIds.map((id) => [id, rpcTransport(id)])),
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
