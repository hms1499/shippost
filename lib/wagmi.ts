import { http } from 'wagmi';
import { celo } from 'wagmi/chains';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { celoSepolia } from './chains';
import { TARGET_CHAIN_ID, getTargetChain } from './targetChain';

export { celoSepolia };

// RainbowKit's getDefaultConfig requires a non-empty projectId at module load.
// Falling back to a placeholder lets builds succeed without WC configured;
// at runtime the WalletConnect option will fail to init but injected/Coinbase
// wallets still work, which covers MiniPay (the priority surface).
const projectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'shippost-placeholder';

const targetChain = getTargetChain();
const rpcUrl =
  TARGET_CHAIN_ID === celoSepolia.id
    ? 'https://forno.celo-sepolia.celo-testnet.org'
    : 'https://forno.celo.org';

export const wagmiConfig = getDefaultConfig({
  appName: 'ShipPost',
  projectId,
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
