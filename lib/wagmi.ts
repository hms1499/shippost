import { http } from 'wagmi';
import { celo, base, baseSepolia } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  safeWallet,
  rainbowWallet,
  base as baseWallet,
  metaMaskWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { celoSepolia, getChain } from './chains';
import { SUPPORTED_CHAIN_IDS, DEFAULT_CHAIN_ID } from './chainPolicy';

export { celoSepolia };

// RainbowKit's getDefaultConfig requires a non-empty projectId at module load.
// Falling back to a placeholder lets builds succeed without WC configured;
// at runtime the WalletConnect option will fail to init but injected/Coinbase
// wallets still work, which covers MiniPay (the priority surface).
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'coinop-placeholder';

const RPC: Record<number, string> = {
  [base.id]: 'https://mainnet.base.org',
  [baseSepolia.id]: 'https://sepolia.base.org',
  [celo.id]: 'https://forno.celo.org',
  [celoSepolia.id]: 'https://forno.celo-sepolia.celo-testnet.org',
};

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
  wallets: [
    {
      groupName: 'Popular',
      wallets: [
        injectedWallet,
        safeWallet,
        rainbowWallet,
        baseWallet,
        metaMaskWallet,
        walletConnectWallet,
      ],
    },
  ],
  chains,
  transports: Object.fromEntries(orderedIds.map((id) => [id, http(RPC[id])])),
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
