import { http } from 'wagmi';
import { celo } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import {
  injectedWallet,
  safeWallet,
  rainbowWallet,
  base,
  metaMaskWallet,
  walletConnectWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { celoSepolia } from './chains';
import { TARGET_CHAIN_ID, getTargetChain } from './targetChain';

export { celoSepolia };

// RainbowKit's getDefaultConfig requires a non-empty projectId at module load.
// Falling back to a placeholder lets builds succeed without WC configured;
// at runtime the WalletConnect option will fail to init but injected/Coinbase
// wallets still work, which covers MiniPay (the priority surface).
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'coinop-placeholder';

const targetChain = getTargetChain();
const rpcUrl =
  TARGET_CHAIN_ID === celoSepolia.id
    ? 'https://forno.celo-sepolia.celo-testnet.org'
    : 'https://forno.celo.org';

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
      wallets: [injectedWallet, safeWallet, rainbowWallet, base, metaMaskWallet, walletConnectWallet],
    },
  ],
  chains: [targetChain],
  transports: {
    [TARGET_CHAIN_ID]: http(rpcUrl),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
